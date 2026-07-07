import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { LedgerEntry } from '../../schemas/ledgerEntry.schema';
import { Customer } from '../../schemas/customer.schema';
import { Order } from '../../schemas/order.schema';
import { Payment } from '../../schemas/payment.schema';
import {
  BalanceAdjustmentDto,
  CreateCustomerDto,
  CustomerQueryDto,
  CustomerSort,
  UpdateCustomerDto,
} from './customer.dto';
import { LedgerService } from '../ledger/ledger.service';
import {
  BalanceDirection,
  EntryType,
  SOURCE_TYPE_MODEL_MAP,
  SourceType,
} from '../../schemas/schema.types';
import {
  CustomerBalanceAdjustment,
  CustomerBalanceAdjustmentDocument,
} from '../../schemas/customerBalanceAdjustment.schema';
import { roundMoney } from '../../common/utils/money.util';
import { userScopeFilter } from '../../common/utils/user-scope.util';

/** Case-insensitive alphabetical sort for customer names (MongoDB collation). */
const NAME_SORT_COLLATION = { locale: 'en', strength: 2 } as const;

@Injectable()
export class CustomerService {
  /**
   * Max gap between a customer's createdAt and its opening-balance adjustment's
   * createdAt. The opening balance is written in the same transaction as the
   * customer (POST /api/customers), so their timestamps are effectively equal.
   * Anything created later is a manual balance adjustment and must NOT be
   * surfaced as the opening-balance note.
   */
  private static readonly OPENING_BALANCE_WINDOW_MS = 5000;

  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntry>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(CustomerBalanceAdjustment.name)
    private readonly customerBalanceAdjustmentModel: Model<CustomerBalanceAdjustmentDocument>,
    private readonly ledgerService: LedgerService,
  ) {}

  private getPagination(page?: number, limit?: number) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;
    return { pageNum, limitNum, skip };
  }

  private buildSearchFilter(search?: string) {
    if (!search) return {};

    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return {
      $or: [
        { firstName: { $regex: safe, $options: 'i' } },
        { lastName: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
      ],
    };
  }

  private buildCustomerIdFilter(customerId: string) {
    const matchConditions: any[] = [{ customerId }];
    if (Types.ObjectId.isValid(customerId)) {
      matchConditions.push({ customerId: new Types.ObjectId(customerId) });
    }

    return { $or: matchConditions };
  }

  private getEntryTypeForAdjustment(direction: BalanceDirection): EntryType {
    if (direction === BalanceDirection.CUSTOMER_OWES) {
      return EntryType.DEBIT;
    }

    return EntryType.CREDIT;
  }

  private async createBalanceAdjustment(
    customerId: string | Types.ObjectId,
    dto: BalanceAdjustmentDto,
    session: ClientSession,
  ) {
    const normalizedAmount = roundMoney(dto.amount);
    const entryType = this.getEntryTypeForAdjustment(dto.direction);
    const adjustment = new this.customerBalanceAdjustmentModel({
      customerId,
      amount: normalizedAmount,
      direction: dto.direction,
      note: dto.note,
    });
    await adjustment.save({ session });

    const ledgerEntry = new this.ledgerModel({
      customerId,
      entryType,
      amount: normalizedAmount,
      sourceType: SourceType.ADJUSTMENT,
      sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.ADJUSTMENT],
      sourceId: adjustment._id,
      note: dto.note ?? null,
    });
    await ledgerEntry.save({ session });

    return adjustment.toObject();
  }

  private normalizeCustomerNote(note?: string | null): string {
    return typeof note === 'string' ? note.trim() : '';
  }

  private withNormalizedNote<T extends { note?: string | null }>(customer: T): T & { note: string } {
    return {
      ...customer,
      note: this.normalizeCustomerNote(customer.note),
    };
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

  async create(userId: string, dto: CreateCustomerDto) {
    const { balanceAdjustment, ...customerData } = dto;
    const session = await this.customerModel.db.startSession();
    session.startTransaction();

    try {
      const customer = new this.customerModel({
        ...customerData,
        note: this.normalizeCustomerNote(customerData.note),
        ...userScopeFilter(userId),
      });
      await customer.save({ session });

      if (balanceAdjustment) {
        await this.createBalanceAdjustment(customer._id as Types.ObjectId, balanceAdjustment, session);
      }

      await session.commitTransaction();
      session.endSession();

      return this.withNormalizedNote(customer.toObject());
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  async findAll(userId: string, query: CustomerQueryDto) {
    const { pageNum, limitNum, skip } = this.getPagination(query.page, query.limit);
    const filter = { ...userScopeFilter(userId), ...this.buildSearchFilter(query.search) };
    const sortRecent = query.sort === CustomerSort.Recent;

    let listQuery = this.customerModel.find(filter);
    if (sortRecent) {
      listQuery = listQuery.sort({ createdAt: -1 });
    } else {
      listQuery = listQuery.collation(NAME_SORT_COLLATION).sort({ firstName: 1, lastName: 1 });
    }

    const [data, total] = await Promise.all([
      listQuery.skip(skip).limit(limitNum).lean().exec(),
      this.customerModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data.map((customer) => this.withNormalizedNote(customer)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  async findOne(userId: string, id: string) {
    const [customer, balance, earliestAdjustment] = await Promise.all([
      this.assertCustomerOwned(userId, id),
      this.ledgerService.getCustomerBalance(userId, id),
      this.findEarliestAdjustment(id),
    ]);

    return {
      ...this.withNormalizedNote(customer),
      balance,
      openingBalanceNote: this.resolveOpeningBalanceNote(customer, earliestAdjustment),
    };
  }

  /** Earliest balance adjustment for a customer (the opening balance, if any). */
  private async findEarliestAdjustment(customerId: string) {
    return this.customerBalanceAdjustmentModel
      .findOne(this.buildCustomerIdFilter(customerId))
      .sort({ createdAt: 1, _id: 1 })
      .select('note createdAt')
      .lean()
      .exec();
  }

  /**
   * Read-only opening-balance note surfaced on the customer detail page. Returns
   * the note of the adjustment created at signup (POST /api/customers), or null
   * when no opening balance was set. Later manual adjustments are excluded via
   * the creation-time window so they can never masquerade as the opening balance.
   */
  private resolveOpeningBalanceNote(
    customer: { createdAt?: Date | string },
    earliestAdjustment: { note?: string | null; createdAt?: Date | string } | null,
  ): string | null {
    if (!earliestAdjustment) {
      return null;
    }

    const customerCreatedAt = customer?.createdAt ? new Date(customer.createdAt).getTime() : null;
    const adjustmentCreatedAt = earliestAdjustment.createdAt
      ? new Date(earliestAdjustment.createdAt).getTime()
      : null;

    if (
      customerCreatedAt !== null &&
      adjustmentCreatedAt !== null &&
      adjustmentCreatedAt - customerCreatedAt > CustomerService.OPENING_BALANCE_WINDOW_MS
    ) {
      return null;
    }

    const note = typeof earliestAdjustment.note === 'string' ? earliestAdjustment.note.trim() : '';
    return note.length > 0 ? note : null;
  }

  async update(userId: string, id: string, dto: UpdateCustomerDto) {
    const updatePayload = { ...dto };
    if ('note' in dto) {
      updatePayload.note = this.normalizeCustomerNote(dto.note);
    }

    const customer = await this.customerModel
      .findOneAndUpdate({ _id: id, ...userScopeFilter(userId) }, updatePayload, {
        returnDocument: 'after',
      })
      .lean()
      .exec();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return this.withNormalizedNote(customer);
  }

  async remove(userId: string, id: string) {
    const customer = await this.customerModel.findOne({ _id: id, ...userScopeFilter(userId) }).exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Delete all related records in parallel
    await Promise.all([
      this.orderModel.deleteMany({ customerId: id }).exec(),
      this.ledgerModel.deleteMany({ customerId: id }).exec(),
      this.paymentModel.deleteMany({ customerId: id }).exec(),
      this.customerBalanceAdjustmentModel.deleteMany({ customerId: id }).exec(),
    ]);

    // Finally, delete the customer
    await this.customerModel.findByIdAndDelete(id).exec();

    return { message: 'Customer and all related records deleted successfully' };
  }

  async adjustBalance(userId: string, customerId: string, dto: BalanceAdjustmentDto) {
    const session = await this.customerModel.db.startSession();
    session.startTransaction();

    try {
      await this.assertCustomerOwned(userId, customerId);

      const adjustment = await this.createBalanceAdjustment(customerId, dto, session);

      await session.commitTransaction();
      session.endSession();

      const balance = await this.ledgerService.getCustomerBalance(userId, customerId);

      return {
        message: 'Balance adjusted successfully',
        adjustment,
        balance,
      };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  /* -------------------- history -------------------- */

  async getOrderHistory(userId: string, customerId: string, page?: number, limit?: number) {
    await this.assertCustomerOwned(userId, customerId);

    const { pageNum, limitNum, skip } = this.getPagination(page, limit);
    const customerFilter = this.buildCustomerIdFilter(customerId);

    const [data, total] = await Promise.all([
      this.orderModel
        .find(customerFilter)
        .populate('customerId', 'firstName lastName email')
        .populate('items.productId', '')
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.orderModel.countDocuments(customerFilter).exec(),
    ]);

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  async getTransactionHistory(userId: string, customerId: string, page?: number, limit?: number) {
    await this.assertCustomerOwned(userId, customerId);

    const { pageNum, limitNum, skip } = this.getPagination(page, limit);
    const customerFilter = this.buildCustomerIdFilter(customerId);

    const [data, total] = await Promise.all([
      this.ledgerModel
        .find(customerFilter)
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.ledgerModel.countDocuments(customerFilter).exec(),
    ]);

    const normalizedData = data.map((entry) => ({
      ...entry,
      note: entry.note ?? '',
    }));

    return {
      data: normalizedData,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }
}
