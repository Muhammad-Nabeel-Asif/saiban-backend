import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LedgerEntry } from '../../schemas/ledgerEntry.schema';
import { Customer } from '../../schemas/customer.schema';
import { Order } from '../../schemas/order.schema';
import { Payment } from '../../schemas/payment.schema';
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './customer.dto';

@Injectable()
export class CustomerService {
  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntry>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
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

  async create(dto: CreateCustomerDto) {
    return this.customerModel.create(dto);
  }

  async findAll(query: CustomerQueryDto) {
    const { pageNum, limitNum, skip } = this.getPagination(query.page, query.limit);
    const filter = this.buildSearchFilter(query.search);

    const [data, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
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
    const customer = await this.customerModel.findById(id).lean().exec();
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.customerModel
      .findByIdAndUpdate(id, dto, { new: true })
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
    ]);

    // Finally, delete the customer
    await this.customerModel.findByIdAndDelete(id).exec();

    return { message: 'Customer and all related records deleted successfully' };
  }

  /* -------------------- history -------------------- */

  async getOrderHistory(customerId: string, page?: number, limit?: number) {
    const { pageNum, limitNum, skip } = this.getPagination(page, limit);

    const [data, total] = await Promise.all([
      this.orderModel
        .find({ customerId })
        .populate('customerId', 'firstName lastName email')
        .populate('items.productId', '')
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.orderModel.countDocuments({ customerId }).exec(),
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

    const [data, total] = await Promise.all([
      this.ledgerModel
        .find({ customerId })
        .skip(skip)
        .limit(limitNum)
        .sort({ transactionDate: -1 })
        .lean()
        .exec(),
      this.ledgerModel.countDocuments({ customerId }).exec(),
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
