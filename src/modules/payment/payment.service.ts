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
import { CreatePaymentDto } from './payment.dto';

@Injectable()
export class PaymentService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderSchemaDocument>,
  ) {}
  async recordPayment(createPaymentDto: CreatePaymentDto) {
    const { customerId, orderId, amount, paymentMethod, reference, note } = createPaymentDto;
    const session = await this.paymentModel.db.startSession();
    session.startTransaction();

    try {
      // Validate order if orderId is provided
      if (orderId) {
        const order = await this.orderModel.findById(orderId).session(session);
        if (!order) throw new NotFoundException('Order not found');
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
        const totalPaid = paidSoFar.length ? paidSoFar[0].total : 0;
        if (totalPaid + amount > order.grandTotal) {
          throw new BadRequestException(
            `Payment exceeds order total. Order total: ${order.grandTotal}, Already paid: ${totalPaid}, Attempted: ${amount}`,
          );
        }
      }

      // Create payment record
      const payment = new this.paymentModel({
        customerId,
        orderId: orderId || null,
        amount,
        paymentMethod,
        reference,
        note,
      });
      await payment.save({ session });

      // Create Ledger CREDIT entry
      const ledgerEntry = new this.ledgerModel({
        customerId,
        entryType: EntryType.CREDIT,
        amount,
        sourceType: SourceType.PAYMENT,
        sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.PAYMENT],
        sourceId: payment._id,
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
