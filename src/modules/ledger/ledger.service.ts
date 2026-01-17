import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name) private ledgerModel: Model<LedgerEntry>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
  ) {}

  async createEntry(data: {
    customerId: string;
    customerName: string;
    type: TransactionType;
    amount: number;
    orderId?: Types.ObjectId;
    paymentMethod?: string;
    reference?: string;
    description: string;
    transactionDate: Date;
  }) {
    const customer = await this.customerModel.findById(data.customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Calculate new balance
    const balanceChange = data.type === TransactionType.DEBIT ? data.amount : -data.amount;
    customer.balance += balanceChange;
    await customer.save();

    // Create ledger entry
    const entry = new this.ledgerModel({
      ...data,
      balance: customer.balance,
    });

    return entry.save();
  }

  async findAll(query: LedgerQueryDto) {
    const { customerId, startDate, endDate, page = 1, limit = 10 } = query;
    const filter: any = {};

    if (customerId) {
      filter.customerId = customerId;
    }

    if (startDate || endDate) {
      filter.transactionDate = {};
      if (startDate) filter.transactionDate.$gte = new Date(startDate);
      if (endDate) filter.transactionDate.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const [entries, total] = await Promise.all([
      this.ledgerModel
        .find(filter)
        .populate('customerId', 'firstName lastName')
        .skip(skip)
        .limit(limit)
        .sort({ transactionDate: -1 }),
      this.ledgerModel.countDocuments(filter),
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

  async getCustomerLedger(customerId: string) {
    const customer = await this.customerModel.findById(customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const entries = await this.ledgerModel.find({ customerId }).sort({ transactionDate: -1 });

    return {
      customer: {
        id: customer._id,
        name: `${customer.firstName} ${customer.lastName}`,
        currentBalance: customer.balance,
      },
      entries,
    };
  }

  async reverseOrderEntries(orderId: string) {
    const entries = await this.ledgerModel.find({ orderId });

    for (const entry of entries) {
      const customer = await this.customerModel.findById(entry.customerId);
      if (customer) {
        // Reverse the balance change
        const balanceChange = entry.type === TransactionType.DEBIT ? -entry.amount : entry.amount;
        customer.balance += balanceChange;
        await customer.save();
      }

      // Mark entry as reversed or delete
      await this.ledgerModel.findByIdAndDelete(entry._id);
    }
  }

  async generateReport(query: LedgerQueryDto) {
    const entries = await this.ledgerModel
      .find({
        ...(query.customerId && { customerId: query.customerId }),
        ...(query.startDate && { transactionDate: { $gte: query.startDate } }),
        ...(query.endDate && { transactionDate: { $lte: query.endDate } }),
      })
      .populate('customerId', 'firstName lastName')
      .sort({ transactionDate: -1 });

    // This would integrate with PDF generation
    return {
      entries,
      summary: {
        totalDebits: entries
          .filter((e) => e.type === TransactionType.DEBIT)
          .reduce((sum, e) => sum + e.amount, 0),
        totalCredits: entries
          .filter((e) => e.type === TransactionType.CREDIT)
          .reduce((sum, e) => sum + e.amount, 0),
      },
      generatedAt: new Date(),
    };
  }
}
