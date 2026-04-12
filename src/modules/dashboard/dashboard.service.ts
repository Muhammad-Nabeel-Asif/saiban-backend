import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from '../../schemas/product.schema';
import { Customer } from '../../schemas/customer.schema';
import { Order } from '../../schemas/order.schema';
import { OrderStatus } from '../../schemas/schema.types';
import { LedgerService } from '../ledger/ledger.service';
import { roundMoney } from '../../common/utils/money.util';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
    private ledgerService: LedgerService,
  ) {}

  async getDashboardMetrics() {
    const [
      totalProducts,
      totalCustomers,
      totalOrders,
      lowStockProducts,
      pendingOrders,
      revenueResult,
      paymentSummary,
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
    ]);

    const totalRevenue = roundMoney(revenueResult.length ? revenueResult[0].totalRevenue : 0);
    const receivedPayments = roundMoney(Math.max(paymentSummary?.netReceivedPayments ?? 0, 0));
    const pendingPayments = roundMoney(Math.max(totalRevenue - receivedPayments, 0));

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
}
