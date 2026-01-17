import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntryType, OrderStatus, PaymentMethod, SourceType } from '../../schemas/schema.types';
import { Payment, PaymentDocument } from '../../schemas/payment.schema';
import { LedgerEntry, LedgerEntryDocument } from '../../schemas/ledgerEntry.schema';
import { Order, OrderSchemaDocument } from '../../schemas/order.schema';
import { CreatePaymentDto } from './payment.dto';

@Injectable()
export class PaymentService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderSchemaDocument>,
  ) {}
  async recordPayment(
    createPaymentDto: CreatePaymentDto,
  ) {
    const { customerId, orderId, amount, paymentMethod, reference, note} = createPaymentDto
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findById(orderId).session(session);
      if (!order) throw new NotFoundException('Order not found');

      const payment = new this.paymentModel({
        customerId,
        orderId,
        amount,
        paymentMethod,
        reference,
        note,
      });
      await payment.save({ session });

      // Ledger CREDIT
      const ledgerEntry = new this.ledgerModel({
        customerId,
        entryType: EntryType.CREDIT,
        amount,
        sourceType: SourceType.PAYMENT,
        sourceId: payment._id,
      });
      await ledgerEntry.save({ session });

      // Optional: update order status
      const totalPaid = await this.paymentModel
        .aggregate([
          { $match: { orderId: order._id } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .session(session);

      if (totalPaid.length && totalPaid[0].total >= order.grandTotal) {
        order.status = OrderStatus.PAID;
        await order.save({ session });
      }

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
