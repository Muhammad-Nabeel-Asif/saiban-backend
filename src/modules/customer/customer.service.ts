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

/** Case-insensitive alphabetical sort for customer names (MongoDB collation). */
const NAME_SORT_COLLATION = { locale: 'en', strength: 2 } as const;

@Injectable()
export class CustomerService {
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
    });
    await ledgerEntry.save({ session });

    return adjustment.toObject();
  }

  async create(dto: CreateCustomerDto) {
    const { balanceAdjustment, ...customerData } = dto;
    const session = await this.customerModel.db.startSession();
    session.startTransaction();

    try {
      const customer = new this.customerModel(customerData);
      await customer.save({ session });

      if (balanceAdjustment) {
        await this.createBalanceAdjustment(customer._id as Types.ObjectId, balanceAdjustment, session);
      }

      await session.commitTransaction();
      session.endSession();

      return customer.toObject();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  async findAll(query: CustomerQueryDto) {
    const { pageNum, limitNum, skip } = this.getPagination(query.page, query.limit);
    const filter = this.buildSearchFilter(query.search);

    const [data, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .collation(NAME_SORT_COLLATION)
        .skip(skip)
        .limit(limitNum)
        .sort({ firstName: 1, lastName: 1 })
        .lean()
        .exec(),
      this.customerModel.countDocuments(filter).exec(),
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

  async findOne(id: string) {
    const [customer, balance] = await Promise.all([
      this.customerModel.findById(id).lean().exec(),
      this.ledgerService.getCustomerBalance(id),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return {
      ...customer,
      balance,
    };
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.customerModel
      .findByIdAndUpdate(id, dto, { returnDocument: 'after' })
      .lean()
      .exec();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async remove(id: string) {
    // Check if customer exists
    const customer = await this.customerModel.findById(id).exec();
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

  async adjustBalance(customerId: string, dto: BalanceAdjustmentDto) {
    const session = await this.customerModel.db.startSession();
    session.startTransaction();

    try {
      const customer = await this.customerModel.findById(customerId).session(session).lean().exec();

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const adjustment = await this.createBalanceAdjustment(customerId, dto, session);

      await session.commitTransaction();
      session.endSession();

      const balance = await this.ledgerService.getCustomerBalance(customerId);

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

  async getOrderHistory(customerId: string, page?: number, limit?: number) {
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

  async getTransactionHistory(customerId: string, page?: number, limit?: number) {
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
}
