import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LedgerEntry, LedgerEntryDocument } from '../../schemas/ledgerEntry.schema';
import { EntryType } from '../../schemas/schema.types';

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
  ) {}

  async getCustomerBalance(customerId: string): Promise<{
    netBalance: number;
    direction: 'customer_owes' | 'we_owe_customer' | 'settled';
    absoluteAmount: number;
  }> {
    const matchConditions: any[] = [{ customerId }];
    if (Types.ObjectId.isValid(customerId)) {
      matchConditions.push({ customerId: new Types.ObjectId(customerId) });
    }

    const result = await this.ledgerModel.aggregate([
      {
        $match: { $or: matchConditions },
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
      return { ...entry, balance: runningBalance };
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
    page: number = 1,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ) {
    const skip = (page - 1) * limit;
    const filter: any = {};

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

    const rawEntriesSnapshot = await this.ledgerModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('customerId sourceType sourceModel sourceId entryType amount')
      .lean()
      .exec();

    // #region agent log
    (globalThis as any)
      .fetch('http://127.0.0.1:7848/ingest/07181aa3-d0f8-4378-b796-ee0aa4633737', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '53ebf1' },
        body: JSON.stringify({
          sessionId: '53ebf1',
          runId: 'pre-fix',
          hypothesisId: 'H3',
          location: 'ledger.service.ts:getAllLedgerEntries:raw-snapshot',
          message: 'Raw ledger entries before populate',
          data: {
            count: rawEntriesSnapshot.length,
            sample: rawEntriesSnapshot.slice(0, 5).map((entry: any) => ({
              id: entry._id?.toString?.() ?? entry._id,
              sourceType: entry.sourceType,
              sourceModel: entry.sourceModel,
              customerId: entry.customerId?.toString?.() ?? entry.customerId,
              sourceId: entry.sourceId?.toString?.() ?? entry.sourceId,
            })),
          },
          timestamp: Date.now(),
        }),
      })
      .catch(() => {});
    // #endregion

    const [validPageEntryIds, validTotalResult] = await Promise.all([
      this.ledgerModel
        .aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          {
            $lookup: {
              from: 'customers',
              localField: 'customerId',
              foreignField: '_id',
              as: 'customerMatch',
            },
          },
          { $match: { customerMatch: { $ne: [] } } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 1 } },
        ])
        .exec(),
      this.ledgerModel
        .aggregate([
          { $match: filter },
          {
            $lookup: {
              from: 'customers',
              localField: 'customerId',
              foreignField: '_id',
              as: 'customerMatch',
            },
          },
          { $match: { customerMatch: { $ne: [] } } },
          { $count: 'total' },
        ])
        .exec(),
    ]);

    const pageIds = validPageEntryIds.map((row: any) => row._id);
    const entries = pageIds.length
      ? await this.ledgerModel
          .find({ _id: { $in: pageIds } })
          .sort({ createdAt: -1 })
          .populate('customerId', 'firstName lastName email')
          .populate('sourceId')
          .lean()
          .exec()
      : [];
    const total = validTotalResult.length ? validTotalResult[0].total : 0;

    // #region agent log
    (globalThis as any)
      .fetch('http://127.0.0.1:7848/ingest/07181aa3-d0f8-4378-b796-ee0aa4633737', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '53ebf1' },
        body: JSON.stringify({
          sessionId: '53ebf1',
          runId: 'post-fix',
          hypothesisId: 'H6',
          location: 'ledger.service.ts:getAllLedgerEntries:runtime-fingerprint',
          message: 'Ledger entries code path fingerprint',
          data: {
            filterVersion: 'valid-customer-filter-v1',
            nodeEnv: process.env.NODE_ENV || 'unknown',
            pid: process.pid,
            page,
            limit,
          },
          timestamp: Date.now(),
        }),
      })
      .catch(() => {});
    // #endregion

    // #region agent log
    (globalThis as any)
      .fetch('http://127.0.0.1:7848/ingest/07181aa3-d0f8-4378-b796-ee0aa4633737', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '53ebf1' },
        body: JSON.stringify({
          sessionId: '53ebf1',
          runId: 'post-fix',
          hypothesisId: 'H5',
          location: 'ledger.service.ts:getAllLedgerEntries:valid-customer-filter',
          message: 'Filtered ledger page to existing customers only',
          data: {
            requestedPage: page,
            requestedLimit: limit,
            selectedEntryCount: entries.length,
            selectedEntryIds: entries.slice(0, 10).map((entry: any) => entry._id?.toString?.() ?? entry._id),
            nullCustomerCountAfterFilter: entries.filter((entry: any) => !entry.customerId).length,
            validTotal: total,
          },
          timestamp: Date.now(),
        }),
      })
      .catch(() => {});
    // #endregion

    const rawById = new Map(
      rawEntriesSnapshot.map((entry: any) => [
        entry._id?.toString?.() ?? String(entry._id),
        {
          customerId: entry.customerId?.toString?.() ?? entry.customerId,
          sourceType: entry.sourceType,
          sourceModel: entry.sourceModel,
          sourceId: entry.sourceId?.toString?.() ?? entry.sourceId,
        },
      ]),
    );
    const nullCustomerAfterPopulate = entries
      .filter((entry: any) => !entry.customerId)
      .map((entry: any) => {
        const id = entry._id?.toString?.() ?? String(entry._id);
        const raw = rawById.get(id);
        return {
          id,
          rawCustomerId: raw?.customerId ?? null,
          rawSourceType: raw?.sourceType ?? null,
          sourceCustomerId:
            entry.sourceId && typeof entry.sourceId === 'object'
              ? entry.sourceId.customerId?.toString?.() ?? entry.sourceId.customerId
              : undefined,
        };
      });

    // #region agent log
    (globalThis as any)
      .fetch('http://127.0.0.1:7848/ingest/07181aa3-d0f8-4378-b796-ee0aa4633737', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '53ebf1' },
        body: JSON.stringify({
          sessionId: '53ebf1',
          runId: 'pre-fix',
          hypothesisId: 'H4',
          location: 'ledger.service.ts:getAllLedgerEntries:after-populate',
          message: 'Ledger entries after populate',
          data: {
            count: entries.length,
            nullCustomerAfterPopulateCount: nullCustomerAfterPopulate.length,
            nullCustomerAfterPopulate: nullCustomerAfterPopulate.slice(0, 10),
            sample: entries.slice(0, 5).map((entry: any) => ({
              id: entry._id?.toString?.() ?? entry._id,
              sourceType: entry.sourceType,
              customerId:
                entry.customerId && typeof entry.customerId === 'object'
                  ? entry.customerId._id?.toString?.() ?? entry.customerId
                  : entry.customerId,
              populatedCustomer:
                !!entry.customerId &&
                typeof entry.customerId === 'object' &&
                !!(entry.customerId._id || entry.customerId.firstName || entry.customerId.email),
              sourceCustomerId:
                entry.sourceId && typeof entry.sourceId === 'object'
                  ? entry.sourceId.customerId?.toString?.() ?? entry.sourceId.customerId
                  : undefined,
            })),
          },
          timestamp: Date.now(),
        }),
      })
      .catch(() => {});
    // #endregion

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
