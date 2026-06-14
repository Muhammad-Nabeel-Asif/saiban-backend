import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LedgerEntry, LedgerEntryDocument } from '../../schemas/ledgerEntry.schema';
import { Customer } from '../../schemas/customer.schema';
import { EntryType, SourceType } from '../../schemas/schema.types';
import { toUserObjectId, userScopeFilter } from '../../common/utils/user-scope.util';

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
  ) {}

  /**
   * Builds an `$or` matcher that catches a customer's ledger entries regardless of
   * whether `customerId` was persisted as a string or ObjectId in that row.
   */
  private buildCustomerIdMatch(customerId: string): { $or: Record<string, unknown>[] } {
    const conditions: Record<string, unknown>[] = [{ customerId }];
    if (Types.ObjectId.isValid(customerId)) {
      conditions.push({ customerId: new Types.ObjectId(customerId) });
    }
    return { $or: conditions };
  }

  private async assertCustomerOwned(userId: string, customerId: string) {
    const customer = await this.customerModel
      .findOne({ _id: customerId, ...userScopeFilter(userId) })
      .lean()
      .exec();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  /**
   * Aggregation stages that:
   *  1. Normalize `customerId` (string or ObjectId) into a single ObjectId field
   *  2. Drop rows whose customer cannot be cast to an ObjectId
   *  3. Drop rows whose customer no longer exists in the customers collection
   *  4. Optionally scope to a single store owner via `userId`
   *
   * Apply these BEFORE any `$group` so per-customer totals are computed against a
   * single, canonical customer identity. Optional `extraMatch` is combined with the
   * normalized-id filter for callers that also want to scope by source/entry type.
   */
  private buildNormalizedCustomerStages(userId?: string, extraMatch: Record<string, unknown> = {}) {
    const userObjectId = userId ? toUserObjectId(userId) : null;

    return [
      {
        $addFields: {
          normalizedCustomerId: {
            $cond: [
              { $eq: [{ $type: '$customerId' }, 'objectId'] },
              '$customerId',
              {
                $convert: {
                  input: '$customerId',
                  to: 'objectId',
                  onError: null,
                  onNull: null,
                },
              },
            ],
          },
        },
      },
      {
        $match: {
          normalizedCustomerId: { $ne: null },
          ...extraMatch,
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'normalizedCustomerId',
          foreignField: '_id',
          as: 'customerMatch',
        },
      },
      { $match: { customerMatch: { $ne: [] } } },
      ...(userObjectId
        ? [{ $match: { 'customerMatch.userId': userObjectId } }]
        : []),
    ];
  }

  async getCustomerBalance(userId: string, customerId: string): Promise<{
    netBalance: number;
    direction: 'customer_owes' | 'we_owe_customer' | 'settled';
    absoluteAmount: number;
  }> {
    await this.assertCustomerOwned(userId, customerId);

    const result = await this.ledgerModel.aggregate([
      {
        $match: this.buildCustomerIdMatch(customerId),
      },
      {
        $group: {
          _id: '$customerId',
          totalDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          balance: { $subtract: ['$totalDebit', '$totalCredit'] },
        },
      },
    ]);

    const netBalance = result.reduce((sum, row) => sum + (row.balance || 0), 0);

    let direction: 'customer_owes' | 'we_owe_customer' | 'settled' = 'settled';
    let absoluteAmount = 0;

    if (netBalance > 0) {
      direction = 'customer_owes';
      absoluteAmount = netBalance;
    } else if (netBalance < 0) {
      direction = 'we_owe_customer';
      absoluteAmount = -netBalance;
    }

    return {
      netBalance,
      direction,
      absoluteAmount,
    };
  }

  async getCustomerBalanceAsOf(
    userId: string,
    customerId: string,
    asOf: Date,
  ): Promise<{
    netBalance: number;
    direction: 'customer_owes' | 'we_owe_customer' | 'settled';
    absoluteAmount: number;
  }> {
    await this.assertCustomerOwned(userId, customerId);

    const result = await this.ledgerModel.aggregate([
      {
        $match: {
          ...this.buildCustomerIdMatch(customerId),
          createdAt: { $lte: asOf },
        },
      },
      {
        $group: {
          _id: '$customerId',
          totalDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          balance: { $subtract: ['$totalDebit', '$totalCredit'] },
        },
      },
    ]);

    const netBalance = result.reduce((sum, row) => sum + (row.balance || 0), 0);

    let direction: 'customer_owes' | 'we_owe_customer' | 'settled' = 'settled';
    let absoluteAmount = 0;

    if (netBalance > 0) {
      direction = 'customer_owes';
      absoluteAmount = netBalance;
    } else if (netBalance < 0) {
      direction = 'we_owe_customer';
      absoluteAmount = -netBalance;
    }

    return {
      netBalance,
      direction,
      absoluteAmount,
    };
  }

  async getCustomerLedgerEntries(
    userId: string,
    customerId: string,
    page: number = 1,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ) {
    await this.assertCustomerOwned(userId, customerId);

    const skip = (page - 1) * limit;
    const filter: any = { customerId: customerId };

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [pageEntries, total, priorBalanceResult] = await Promise.all([
      this.ledgerModel
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate('sourceId')
        .lean()
        .exec(),
      this.ledgerModel.countDocuments(filter).exec(),
      skip > 0
        ? this.ledgerModel.aggregate([
            { $match: filter },
            { $sort: { createdAt: 1 } },
            { $limit: skip },
            {
              $group: {
                _id: null,
                balance: {
                  $sum: {
                    $cond: [
                      { $eq: ['$entryType', EntryType.DEBIT] },
                      '$amount',
                      { $multiply: ['$amount', -1] },
                    ],
                  },
                },
              },
            },
          ])
        : Promise.resolve([]),
    ]);

    let runningBalance = priorBalanceResult.length ? priorBalanceResult[0].balance : 0;

    const entriesWithBalance = pageEntries.map((entry) => {
      if (entry.entryType === EntryType.DEBIT) {
        runningBalance += entry.amount;
      } else {
        runningBalance -= entry.amount;
      }
      return {
        ...entry,
        note: this.resolveEntryNote(entry),
        balance: runningBalance,
      };
    });

    return {
      data: entriesWithBalance.reverse(),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAllLedgerEntries(
    userId: string,
    page: number = 1,
    limit: number = 10,
    customerId?: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const skip = (page - 1) * limit;
    const filter: any = {};

    if (customerId) {
      await this.assertCustomerOwned(userId, customerId);
      Object.assign(filter, this.buildCustomerIdMatch(customerId));
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        // Set to start of day in UTC
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        // Set to end of day in UTC to include entire day
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const validCustomerPipeline = this.buildNormalizedCustomerStages(userId);

    const [validPageEntryIds, validTotalResult] = await Promise.all([
      this.ledgerModel
        .aggregate([
          { $match: filter },
          ...validCustomerPipeline,
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 1 } },
        ])
        .exec(),
      this.ledgerModel
        .aggregate([{ $match: filter }, ...validCustomerPipeline, { $count: 'total' }])
        .exec(),
    ]);

    const pageIds = validPageEntryIds.map((row: any) => row._id);
    const entries = pageIds.length
      ? await this.ledgerModel
          .find({ _id: { $in: pageIds } })
          .sort({ createdAt: -1, _id: -1 })
          .populate('customerId', 'firstName lastName email')
          .populate('sourceId')
          .lean()
          .exec()
      : [];
    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      note: this.resolveEntryNote(entry),
    }));
    const total = validTotalResult.length ? validTotalResult[0].total : 0;

    return {
      data: normalizedEntries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getDateRangeReport(userId: string, startDate: Date, endDate: Date) {
    const report = await this.ledgerModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      ...this.buildNormalizedCustomerStages(userId),
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          totalDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $project: {
          date: '$_id',
          totalDebit: 1,
          totalCredit: 1,
          netAmount: { $subtract: ['$totalDebit', '$totalCredit'] },
          transactionCount: 1,
          _id: 0,
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    return report;
  }

  /**
   * Net payments received (CREDIT − DEBIT) across all payment-source ledger entries.
   * Uses the same normalization pipeline as `getTotalPendingReceivables` so the
   * "received" and "pending" cards on the dashboard share an identical universe:
   *  - rows belong to a real customer
   *  - rows tied to deleted/orphaned customers are excluded
   */
  async getDashboardPaymentSummary(userId: string) {
    const paymentSummary = await this.ledgerModel.aggregate([
      ...this.buildNormalizedCustomerStages(userId, { sourceType: SourceType.PAYMENT }),
      {
        $group: {
          _id: null,
          totalPaymentCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
          totalPaymentDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalPaymentCredit: 1,
          totalPaymentDebit: 1,
          netReceivedPayments: { $subtract: ['$totalPaymentCredit', '$totalPaymentDebit'] },
        },
      },
    ]);

    const resolvedPaymentSummary = paymentSummary.length
      ? paymentSummary[0]
      : { totalPaymentCredit: 0, totalPaymentDebit: 0, netReceivedPayments: 0 };

    return resolvedPaymentSummary;
  }

  /**
   * Total outstanding from customers (sum of positive balances).
   * Groups by normalized customerId so string/ObjectId duplicates are not double-counted.
   */
  async getTotalPendingReceivables(userId: string): Promise<number> {
    const result = await this.ledgerModel.aggregate([
      ...this.buildNormalizedCustomerStages(userId),
      {
        $group: {
          _id: '$normalizedCustomerId',
          totalDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          balance: { $subtract: ['$totalDebit', '$totalCredit'] },
        },
      },
      { $match: { balance: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          totalPending: { $sum: '$balance' },
        },
      },
    ]);

    return result.length ? result[0].totalPending : 0;
  }

  async getLedgerSummary(userId: string) {
    const summary = await this.ledgerModel.aggregate([
      ...this.buildNormalizedCustomerStages(userId),
      {
        $group: {
          _id: null,
          totalDebit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.DEBIT] }, '$amount', 0],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $eq: ['$entryType', EntryType.CREDIT] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalReceivable: { $subtract: ['$totalDebit', '$totalCredit'] },
          totalDebit: 1,
          totalCredit: 1,
        },
      },
    ]);

    const resolvedSummary = summary.length
      ? summary[0]
      : { totalReceivable: 0, totalDebit: 0, totalCredit: 0 };

    return resolvedSummary;
  }

  private resolveEntryNote(entry: any): string {
    if (typeof entry?.note === 'string') {
      return entry.note;
    }

    const source = entry?.sourceId;
    if (source && typeof source === 'object' && typeof source.note === 'string') {
      return source.note;
    }

    return '';
  }
}
