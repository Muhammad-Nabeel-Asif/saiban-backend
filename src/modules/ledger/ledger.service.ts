import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LedgerEntry, LedgerEntryDocument } from '../../schemas/ledgerEntry.schema';
import { EntryType, SourceType } from '../../schemas/schema.types';
import { RevenueQueryDto } from '../payment/payment.dto';
import { Customer } from '../../schemas/customer.schema';

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
  ) {}

  async getCustomerBalance(customerId: string): Promise<{ balance: number }> {
    const result = await this.ledgerModel.aggregate([
      { $match: { customerId: new Types.ObjectId(customerId) } },
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

    return result.length ? { balance: result[0].balance } : { balance: 0 };
  }

  async getRevenue({ start, end }: RevenueQueryDto): Promise<{ revenue: number }> {
    const result = await this.ledgerModel.aggregate([
      {
        $match: {
          entryType: EntryType.DEBIT,
          sourceType: SourceType.ORDER,
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } },
    ]);

    return result.length ? { revenue: result[0].totalRevenue } : { revenue: 0 };
  }

  async getCustomerLedgerEntries(
    customerId: string,
    page: number = 1,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ) {
    const skip = (page - 1) * limit;
    const filter: any = { customerId: customerId };

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = startDate;
      if (endDate) filter.createdAt.$lte = endDate;
    }

    const [entries, total] = await Promise.all([
      this.ledgerModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sourceId')
        .lean()
        .exec(),
      this.ledgerModel.countDocuments(filter).exec(),
    ]);

    // Calculate running balance for each entry
    const entriesWithBalance = [];
    let runningBalance = 0;

    // Get all entries up to the last one in current page to calculate running balance
    const allEntriesUpToPage = await this.ledgerModel
      .find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    for (const entry of allEntriesUpToPage) {
      if (entry.entryType === EntryType.DEBIT) {
        runningBalance += entry.amount;
      } else {
        runningBalance -= entry.amount;
      }
      // @ts-ignore
      entriesWithBalance.push({
        ...entry,
        balance: runningBalance,
      });
    }

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
    page: number = 1,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ) {
    const skip = (page - 1) * limit;
    const filter: any = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = startDate;
      if (endDate) filter.createdAt.$lte = endDate;
    }

    const [entries, total] = await Promise.all([
      this.ledgerModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'firstName lastName email')
        .populate('sourceId')
        .lean()
        .exec(),
      this.ledgerModel.countDocuments(filter).exec(),
    ]);

    return {
      data: entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerWiseReport(startDate?: Date, endDate?: Date) {
    const matchStage: any = {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const pipeline: any[] = [];

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
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
          transactionCount: { $sum: 1 },
        },
      },
      {
        $project: {
          customerId: '$_id',
          totalDebit: 1,
          totalCredit: 1,
          balance: { $subtract: ['$totalDebit', '$totalCredit'] },
          transactionCount: 1,
          _id: 0,
        },
      },
      {
        $lookup: {
          from: this.customerModel.collection.name,
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $unwind: {
          path: '$customer',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          customerId: 1,
          customerName: {
            $cond: {
              if: { $ne: ['$customer', null] },
              then: {
                $concat: [
                  { $ifNull: ['$customer.firstName', ''] },
                  ' ',
                  { $ifNull: ['$customer.lastName', ''] },
                ],
              },
              else: 'Unknown Customer',
            },
          },
          customerEmail: { $ifNull: ['$customer.email', 'N/A'] },
          totalDebit: 1,
          totalCredit: 1,
          balance: 1,
          transactionCount: 1,
        },
      },
      {
        $sort: { balance: -1 },
      },
    );

    const report = await this.ledgerModel.aggregate(pipeline);
    return report;
  }

  async getDateRangeReport(startDate: Date, endDate: Date) {
    const report = await this.ledgerModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
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

  async getLedgerSummary() {
    const summary = await this.ledgerModel.aggregate([
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

    return summary.length ? summary[0] : { totalReceivable: 0, totalDebit: 0, totalCredit: 0 };
  }
}
