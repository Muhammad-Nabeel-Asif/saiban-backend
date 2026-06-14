import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EntryType,
  OrderStatus,
  SOURCE_TYPE_MODEL_MAP,
  SourceType,
} from '../../schemas/schema.types';
import { Payment, PaymentDocument } from '../../schemas/payment.schema';
import { LedgerEntry, LedgerEntryDocument } from '../../schemas/ledgerEntry.schema';
import { Order, OrderSchemaDocument } from '../../schemas/order.schema';
import { Customer } from '../../schemas/customer.schema';
import { CreatePaymentDto } from './payment.dto';
import { roundMoney } from '../../common/utils/money.util';
import { userScopeFilter } from '../../common/utils/user-scope.util';

@Injectable()
export class PaymentService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderSchemaDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
  ) {}
  async recordPayment(userId: string, createPaymentDto: CreatePaymentDto) {
    const { customerId, orderId, amount, paymentMethod, note } = createPaymentDto;
    const normalizedAmount = roundMoney(amount);
    const session = await this.paymentModel.db.startSession();
    session.startTransaction();

    try {
      const customer = await this.customerModel
        .findOne({ _id: customerId, ...userScopeFilter(userId) })
        .session(session);
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      // Validate order if orderId is provided
      if (orderId) {
        const order = await this.orderModel
          .findOne({ _id: orderId, ...userScopeFilter(userId) })
          .session(session);
        if (!order) throw new NotFoundException('Order not found');
        if (String(order.customerId) !== String(customerId)) {
          throw new BadRequestException('Order does not belong to this customer');
        }
        if (order.status === OrderStatus.CANCELLED)
          throw new BadRequestException('Cannot record payment for a cancelled order');

        const orderIdMatch: any[] = [{ orderId }];
        if (Types.ObjectId.isValid(orderId)) {
          orderIdMatch.push({ orderId: new Types.ObjectId(orderId) });
        }
        const paidSoFar = await this.paymentModel.aggregate([
          { $match: { $or: orderIdMatch } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        const totalPaid = roundMoney(paidSoFar.length ? paidSoFar[0].total : 0);
        const orderTotal = roundMoney(order.grandTotal);

        if (roundMoney(totalPaid + normalizedAmount) > orderTotal) {
          throw new BadRequestException(
            `Payment exceeds order total. Order total: ${orderTotal}, Already paid: ${totalPaid}, Attempted: ${normalizedAmount}`,
          );
        }
      }

      // Create payment record
      const payment = new this.paymentModel({
        customerId,
        orderId: orderId || null,
        amount: normalizedAmount,
        paymentMethod,
        note,
      });
      await payment.save({ session });

      // Create Ledger CREDIT entry
      const ledgerEntry = new this.ledgerModel({
        customerId,
        entryType: EntryType.CREDIT,
        amount: normalizedAmount,
        sourceType: SourceType.PAYMENT,
        sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.PAYMENT],
        sourceId: payment._id,
        note: note ?? null,
      });
      await ledgerEntry.save({ session });

      await session.commitTransaction();
      session.endSession();

      return payment;
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }
}
