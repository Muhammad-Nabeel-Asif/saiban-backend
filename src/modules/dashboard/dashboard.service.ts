import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from '../../schemas/product.schema';
import { Customer } from '../../schemas/customer.schema';
import { Order } from '../../schemas/order.schema';
import { OrderStatus } from '../../schemas/schema.types';
import { LedgerService } from '../ledger/ledger.service';
import { roundMoney } from '../../common/utils/money.util';
import { DashboardRevenueRange, DashboardRevenueTrendQueryDto } from './dashboard.dto';

@Injectable()
export class DashboardService {
  private static readonly DEFAULT_TIMEZONE = 'Asia/Karachi';
  private static readonly REVENUE_TREND_CURRENCY = 'PKR';
  private static readonly EXCLUDED_STATUSES = [OrderStatus.CANCELLED];
  private static readonly RANGE_DAY_COUNT: Record<DashboardRevenueRange, number> = {
    '7d': 7,
    '14d': 14,
    '30d': 30,
    '90d': 90,
  };

  constructor(
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Dashboard KPIs. These three money metrics intentionally measure different things;
   * do NOT expect `totalRevenue - receivedPayments === pendingPayments`:
   *
   *  - totalRevenue:     sum of `grandTotal` on COMPLETED orders only (realized sales).
   *  - receivedPayments: net payment-source ledger movement (CREDIT − DEBIT) across
   *                      ledger entries belonging to real customers.
   *  - pendingPayments:  sum of positive customer balances across the ENTIRE ledger
   *                      (orders, payments, returns, balance adjustments). It can
   *                      legitimately exceed `totalRevenue` when there are pending
   *                      orders or opening balance adjustments that are not yet
   *                      reflected in completed-order revenue.
   */
  async getDashboardMetrics() {
    const [
      totalProducts,
      totalCustomers,
      totalOrders,
      lowStockProducts,
      pendingOrders,
      revenueResult,
      paymentSummary,
      totalPendingReceivables,
    ] = await Promise.all([
      this.productModel.countDocuments(),
      this.customerModel.countDocuments(),
      this.orderModel.countDocuments(),
      this.productModel
        .find({
          $expr: { $lte: ['$quantityInStock', '$lowStockThreshold'] },
        })
        .limit(20),
      this.orderModel
        .find({ status: OrderStatus.PENDING })
        .populate('customerId', 'firstName lastName')
        .limit(10)
        .sort({ createdAt: -1 }),
      this.orderModel.aggregate([
        { $match: { status: OrderStatus.COMPLETED } },
        { $group: { _id: null, totalRevenue: { $sum: '$grandTotal' } } },
      ]),
      this.ledgerService.getDashboardPaymentSummary(),
      this.ledgerService.getTotalPendingReceivables(),
    ]);

    const totalRevenue = roundMoney(revenueResult.length ? revenueResult[0].totalRevenue : 0);
    const receivedPayments = roundMoney(Math.max(paymentSummary?.netReceivedPayments ?? 0, 0));
    const pendingPayments = roundMoney(totalPendingReceivables);

    return {
      metrics: {
        totalProducts,
        totalCustomers,
        totalOrders,
        totalRevenue,
        pendingPayments,
        receivedPayments,
      },
      alerts: {
        lowStockProducts: lowStockProducts.map((p) => ({
          id: p._id,
          name: p.name,
          currentStock: p.quantityInStock,
          threshold: p.lowStockThreshold,
        })),
        pendingOrders: pendingOrders.map((o) => ({
          id: o._id,
          customerId: o.customerId,
          customerName: (o.customerId as any)?.firstName
            ? `${(o.customerId as any).firstName} ${(o.customerId as any).lastName}`
            : 'Unknown',
          amount: o.grandTotal,
          createdAt: (o as any).createdAt,
        })),
      },
    };
  }

  async getRevenueTrend(query: DashboardRevenueTrendQueryDto) {
    const timezone = this.resolveTimezone(query.timezone);
    const todayInTimezone = this.formatDateInTimezone(new Date(), timezone);
    const rangeDayCount = DashboardService.RANGE_DAY_COUNT[query.range];
    const startDateInTimezone = this.shiftDateKey(todayInTimezone, -(rangeDayCount - 1));

    const rangeStartUtc = this.toUtcStartOfDay(startDateInTimezone, timezone);
    const rangeEndUtc = this.toUtcEndOfDay(todayInTimezone, timezone);

    const granularity = query.range === '90d' ? 'week' : 'day';
    const groupingExpression =
      granularity === 'day'
        ? {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone,
            },
          }
        : {
            $dateToString: {
              format: '%Y-%m-%d',
              date: {
                $dateTrunc: {
                  date: '$createdAt',
                  unit: 'week',
                  startOfWeek: 'sunday',
                  timezone,
                },
              },
              timezone,
            },
          };

    const aggregation = await this.orderModel.aggregate([
      {
        $match: {
          status: OrderStatus.COMPLETED,
          createdAt: {
            $gte: rangeStartUtc,
            $lte: rangeEndUtc,
          },
        },
      },
      {
        $group: {
          _id: groupingExpression,
          revenue: { $sum: '$grandTotal' },
          orderCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          bucketKey: '$_id',
          revenue: 1,
          orderCount: 1,
        },
      },
      {
        $sort: { bucketKey: 1 },
      },
    ]);

    const groupedLookup = new Map<
      string,
      {
        revenue: number;
        orderCount: number;
      }
    >();

    for (const row of aggregation) {
      groupedLookup.set(row.bucketKey, {
        revenue: roundMoney(row.revenue ?? 0),
        orderCount: row.orderCount ?? 0,
      });
    }

    const series =
      granularity === 'day'
        ? this.buildDailySeries({
            startDate: startDateInTimezone,
            dayCount: rangeDayCount,
            groupedLookup,
          })
        : this.buildWeeklySeries({
            startDate: startDateInTimezone,
            endDate: todayInTimezone,
            groupedLookup,
          });

    const totalRevenue = roundMoney(series.reduce((sum, point) => sum + point.revenue, 0));
    const orderCount = series.reduce((sum, point) => sum + point.orderCount, 0);

    return {
      range: query.range,
      granularity,
      timezone,
      summary: {
        totalRevenue,
        orderCount,
        currency: DashboardService.REVENUE_TREND_CURRENCY,
        excludedStatuses: DashboardService.EXCLUDED_STATUSES,
      },
      series,
    };
  }

  private buildDailySeries({
    startDate,
    dayCount,
    groupedLookup,
  }: {
    startDate: string;
    dayCount: number;
    groupedLookup: Map<string, { revenue: number; orderCount: number }>;
  }) {
    const points: Array<{
      bucketStart: string;
      bucketEnd: string;
      label: string;
      revenue: number;
      orderCount: number;
    }> = [];

    for (let index = 0; index < dayCount; index += 1) {
      const key = this.shiftDateKey(startDate, index);
      const aggregated = groupedLookup.get(key);

      points.push({
        bucketStart: key,
        bucketEnd: key,
        label: this.formatChartLabel(key),
        revenue: roundMoney(aggregated?.revenue ?? 0),
        orderCount: aggregated?.orderCount ?? 0,
      });
    }

    return points;
  }

  private buildWeeklySeries({
    startDate,
    endDate,
    groupedLookup,
  }: {
    startDate: string;
    endDate: string;
    groupedLookup: Map<string, { revenue: number; orderCount: number }>;
  }) {
    const points: Array<{
      bucketStart: string;
      bucketEnd: string;
      label: string;
      revenue: number;
      orderCount: number;
    }> = [];

    let currentWeekStart = this.startOfWeekSunday(startDate);

    while (currentWeekStart <= endDate) {
      const currentWeekEnd = this.shiftDateKey(currentWeekStart, 6);

      const bucketStartDate = this.maxDate(currentWeekStart, startDate);
      const bucketEndDate = this.minDate(currentWeekEnd, endDate);
      const weekKey = currentWeekStart;
      const aggregated = groupedLookup.get(weekKey);

      points.push({
        bucketStart: bucketStartDate,
        bucketEnd: bucketEndDate,
        label: this.formatChartLabel(bucketStartDate),
        revenue: roundMoney(aggregated?.revenue ?? 0),
        orderCount: aggregated?.orderCount ?? 0,
      });

      currentWeekStart = this.shiftDateKey(currentWeekStart, 7);
    }

    return points;
  }

  private resolveTimezone(timezone?: string): string {
    const resolved = timezone?.trim() || DashboardService.DEFAULT_TIMEZONE;
    if (!this.isValidTimezone(resolved)) {
      throw new BadRequestException('Invalid timezone');
    }
    return resolved;
  }

  private isValidTimezone(timezone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  private formatDateInTimezone(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new BadRequestException('Unable to resolve timezone date');
    }

    return `${year}-${month}-${day}`;
  }

  private toUtcStartOfDay(localDate: string, timezone: string): Date {
    return new Date(`${localDate}T00:00:00.000${this.getTimezoneOffsetSuffix(localDate, timezone)}`);
  }

  private toUtcEndOfDay(localDate: string, timezone: string): Date {
    return new Date(`${localDate}T23:59:59.999${this.getTimezoneOffsetSuffix(localDate, timezone)}`);
  }

  private getTimezoneOffsetSuffix(dateKey: string, timezone: string): string {
    const referenceDate = new Date(`${dateKey}T12:00:00.000Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(referenceDate);

    const offsetValue = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (!offsetValue || offsetValue === 'UTC' || offsetValue === 'GMT') {
      return 'Z';
    }

    const normalizedOffset = offsetValue.replace('UTC', 'GMT');
    const match = normalizedOffset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) {
      throw new BadRequestException('Unable to resolve timezone offset');
    }

    const [, sign, rawHours, rawMinutes] = match;
    const hours = rawHours.padStart(2, '0');
    const minutes = (rawMinutes ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  }

  private shiftDateKey(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return this.formatDateKeyFromUtcDate(date);
  }

  private formatDateKeyFromUtcDate(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatChartLabel(dateKey: string): string {
    const value = new Date(`${dateKey}T00:00:00.000Z`);
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(value);
  }

  private startOfWeekSunday(dateKey: string): string {
    const value = new Date(`${dateKey}T00:00:00.000Z`);
    const dayOfWeek = value.getUTCDay();
    return this.shiftDateKey(dateKey, -dayOfWeek);
  }

  private minDate(a: string, b: string): string {
    return a <= b ? a : b;
  }

  private maxDate(a: string, b: string): string {
    return a >= b ? a : b;
  }
}
