import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Order } from '../../schemas/order.schema';
import { Product } from '../../schemas/product.schema';
import { Customer } from '../../schemas/customer.schema';
import { Counter } from '../../schemas/counter.schema';
import { CreateOrderDto, OrderQueryDto } from './order.dto';
import {
  EntryType,
  OrderStatus,
  SOURCE_TYPE_MODEL_MAP,
  SourceType,
  StockMovementReason,
} from '../../schemas/schema.types';
import { StockMovement } from '../../schemas/stockMovement.schema';
import { LedgerEntry } from '../../schemas/ledgerEntry.schema';
import { Payment } from '../../schemas/payment.schema';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(StockMovement.name) private stockMovementModel: Model<StockMovement>,
    @InjectModel(LedgerEntry.name) private ledgerEntryModel: Model<LedgerEntry>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
    @InjectModel(Customer.name) private customerModel: Model<Customer>,
    @InjectModel(Counter.name) private counterModel: Model<Counter>,
    private ledgerService: LedgerService,
  ) {}

  async create(dto: CreateOrderDto): Promise<any> {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      // 1. Fetch product prices and validate stock
      const productIds = dto.items.map((i) => i.productId);
      const products = await this.productModel.find({ _id: { $in: productIds } }).session(session);

      if (products.length !== productIds.length) {
        throw new BadRequestException('Some products not found');
      }

      const productMap: any = new Map(products.map((p) => [p._id.toString(), p]));

      // 2. Validate sufficient stock and deduct immediately
      for (const item of dto.items) {
        const product = productMap.get(item.productId);
        if (product.quantityInStock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product: ${product.name}. Available: ${product.quantityInStock}, Requested: ${item.quantity}`,
          );
        }

        // Deduct stock immediately
        product.quantityInStock -= item.quantity;
        await product.save({ session });
      }

      // 3. Build Order Items (server-authoritative pricing)
      const items = dto.items.map((item) => {
        const product = productMap.get(item.productId);
        return {
          productId: product._id,
          quantity: item.quantity,
          unitPrice: product.unitPrice,
          discountPercentage: item.discountPercentage ?? 0,
          discountAmount: 0, // schema pre-hook will calculate
          lineTotal: 0, // schema pre-hook will calculate
        };
      });

      // 4. Create order with PENDING status
      const invoiceNumber = await this.generateInvoiceNumber(session);

      const order = new this.orderModel({
        customerId: dto.customerId,
        status: OrderStatus.PENDING,
        items,
        note: dto.note,
        invoiceNumber,
      });

      await order.save({ session });

      // 5. Create stock movement records
      const stockMovements = items.map((item) => ({
        productId: item.productId,
        quantityChange: -item.quantity,
        reason: StockMovementReason.ORDER,
        referenceId: order._id,
      }));

      await this.stockMovementModel.insertMany(stockMovements, { session });

      // 6. Create Ledger Entry (DEBIT) - customer owes this amount
      const ledgerEntry = new this.ledgerEntryModel({
        customerId: dto.customerId,
        entryType: EntryType.DEBIT,
        amount: order.grandTotal,
        sourceType: SourceType.ORDER,
        sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.ORDER],
        sourceId: order._id,
      });

      await ledgerEntry.save({ session });

      await session.commitTransaction();
      await session.endSession();
      return order;
    } catch (err) {
      console.error({ err });
      await session.abortTransaction();
      await session.endSession();
      throw err;
    }
  }

  async findAll(query: OrderQueryDto) {
    const { page = 1, limit = 10, search, status, customerId } = query;
    const filter: any = {};

    // Handle customerId filter
    if (customerId) {
      filter.customerId = customerId;
    }
    // If search is provided, find matching customers first
    else if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingCustomers = await this.customerModel
        .find({
          $or: [
            { firstName: { $regex: safe, $options: 'i' } },
            { lastName: { $regex: safe, $options: 'i' } },
            { email: { $regex: safe, $options: 'i' } },
          ],
        })
        .select('_id')
        .lean()
        .exec();

      const customerIds = matchingCustomers.map((c) => c._id.toString());

      // If no matching customers found, set filter to match nothing
      if (customerIds.length === 0) {
        filter.customerId = null; // Will match no orders
      } else {
        filter.customerId = { $in: customerIds };
      }
    }

    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .populate('customerId', 'firstName lastName email')
        .populate('items.productId', '')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      data: orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async confirmOrder(orderId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.COMPLETED)
      throw new BadRequestException('Order already completed');
    if (order.status === OrderStatus.CANCELLED)
      throw new BadRequestException('Cannot confirm cancelled order');
    if (order.status === OrderStatus.RETURNED)
      throw new BadRequestException('Cannot confirm a returned order');

    order.status = OrderStatus.COMPLETED;
    await order.save();

    return {
      order,
      message: 'Order confirmed and completed successfully',
    };
  }

  async cancelOrder(orderId: string) {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findById(orderId).session(session);
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === OrderStatus.CANCELLED)
        throw new BadRequestException('Order already cancelled');
      if (order.status === OrderStatus.COMPLETED)
        throw new BadRequestException(
          'Cannot cancel a completed order. Use the return endpoint instead.',
        );

      order.status = OrderStatus.CANCELLED;
      await order.save({ session });

      // Restore stock to products
      for (const item of order.items) {
        await this.productModel.findByIdAndUpdate(
          item.productId,
          { $inc: { quantityInStock: item.quantity } },
          { session },
        );
      }

      // Create stock movement records
      const stockReversal = order.items.map((item) => ({
        productId: item.productId,
        quantityChange: item.quantity,
        reason: StockMovementReason.RETURN,
        referenceId: order._id,
      }));
      await this.stockMovementModel.insertMany(stockReversal, { session });

      // Reverse ledger (order DEBIT -> CREDIT reversal)
      const ledgerReversal = new this.ledgerEntryModel({
        customerId: order.customerId,
        entryType: EntryType.CREDIT,
        amount: order.grandTotal,
        sourceType: SourceType.ORDER,
        sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.ORDER],
        sourceId: order._id,
      });
      await ledgerReversal.save({ session });

      // Reverse auto-payment if one was created at order time
      const autoPayment = await this.paymentModel.findOne({ orderId: order._id }).session(session);
      if (autoPayment) {
        const paymentReversal = new this.ledgerEntryModel({
          customerId: order.customerId,
          entryType: EntryType.DEBIT,
          amount: autoPayment.amount,
          sourceType: SourceType.PAYMENT,
          sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.PAYMENT],
          sourceId: autoPayment._id,
        });
        await paymentReversal.save({ session });
      }

      await session.commitTransaction();
      await session.endSession();

      return order;
    } catch (err) {
      await session.abortTransaction();
      await session.endSession();
      throw err;
    }
  }

  async returnOrder(orderId: string) {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findById(orderId).session(session);
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== OrderStatus.COMPLETED)
        throw new BadRequestException('Only completed orders can be returned');

      order.status = OrderStatus.RETURNED;
      await order.save({ session });

      // Restore stock
      for (const item of order.items) {
        await this.productModel.findByIdAndUpdate(
          item.productId,
          { $inc: { quantityInStock: item.quantity } },
          { session },
        );
      }

      // Create stock movement records
      const stockReversal = order.items.map((item) => ({
        productId: item.productId,
        quantityChange: item.quantity,
        reason: StockMovementReason.RETURN,
        referenceId: order._id,
      }));
      await this.stockMovementModel.insertMany(stockReversal, { session });

      // Reverse ledger (order DEBIT -> CREDIT reversal)
      const ledgerReversal = new this.ledgerEntryModel({
        customerId: order.customerId,
        entryType: EntryType.CREDIT,
        amount: order.grandTotal,
        sourceType: SourceType.RETURN,
        sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.RETURN],
        sourceId: order._id,
      });
      await ledgerReversal.save({ session });

      // Reverse auto-payment if one was created at order time
      const autoPayment = await this.paymentModel.findOne({ orderId: order._id }).session(session);
      if (autoPayment) {
        const paymentReversal = new this.ledgerEntryModel({
          customerId: order.customerId,
          entryType: EntryType.DEBIT,
          amount: autoPayment.amount,
          sourceType: SourceType.PAYMENT,
          sourceModel: SOURCE_TYPE_MODEL_MAP[SourceType.PAYMENT],
          sourceId: autoPayment._id,
        });
        await paymentReversal.save({ session });
      }

      await session.commitTransaction();
      await session.endSession();

      return {
        order,
        message: 'Order returned successfully',
      };
    } catch (err) {
      await session.abortTransaction();
      await session.endSession();
      throw err;
    }
  }

  async findOne(id: string) {
    const order = await this.orderModel
      .findById(id)
      .populate('customerId')
      .populate('items.productId')
      .lean()
      .exec();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const rawCustomerId = order.customerId;
    const customerIdStr =
      rawCustomerId && typeof rawCustomerId === 'object' && '_id' in rawCustomerId
        ? String((rawCustomerId as { _id: unknown })._id)
        : String(rawCustomerId);

    const customerBalance = await this.ledgerService.getCustomerBalance(customerIdStr);
    const customerIdNormalized = this.normalizeOrderCustomerSnapshot(rawCustomerId, customerIdStr);

    return {
      ...order,
      customerId: customerIdNormalized,
      customerBalance,
    };
  }

  /**
   * Ensures every expected customer field is present (empty string when unset)
   * so clients can read keys without optional chaining on missing properties.
   */
  private normalizeOrderCustomerSnapshot(
    populated: unknown,
    customerIdFallback: string,
  ): {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    streetAddress: string;
    city: string;
    state: string;
  } {
    const empty = '';
    const asStr = (v: unknown) => (v == null ? empty : String(v));

    if (!populated || typeof populated !== 'object') {
      return {
        _id: customerIdFallback,
        firstName: empty,
        lastName: empty,
        email: empty,
        phoneNumber: empty,
        streetAddress: empty,
        city: empty,
        state: empty,
      };
    }

    const c = populated as Record<string, unknown>;
    const id = c._id != null ? String(c._id) : customerIdFallback;

    return {
      _id: id,
      firstName: asStr(c.firstName),
      lastName: asStr(c.lastName),
      email: asStr(c.email),
      phoneNumber: asStr(c.phoneNumber),
      streetAddress: asStr(c.streetAddress),
      city: asStr(c.city),
      state: asStr(c.state),
    };
  }

  /**
   * Atomically increments a monthly counter and returns a formatted invoice number.
   * Format: INV-YYMM-XXXX (e.g. INV-2604-0001)
   * The counter resets each month via a new key.
   */
  private buildCounterKey(date: Date): string {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `invoice-${yy}${mm}`;
  }

  private buildInvoiceString(counterKey: string, seq: number): string {
    const yyMm = counterKey.replace('invoice-', '');
    return `INV-${yyMm}-${String(seq).padStart(4, '0')}`;
  }

  private async generateInvoiceNumber(session: ClientSession): Promise<string> {
    const key = this.buildCounterKey(new Date());

    const counter = await this.counterModel.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, session },
    );

    return this.buildInvoiceString(key, counter.seq);
  }

  /**
   * Assigns invoice numbers to all existing orders that don't have one.
   * Uses each order's createdAt to place it in the correct monthly bucket.
   * Sorted by createdAt ascending so older orders get lower sequence numbers.
   */
  async backfillInvoiceNumbers(): Promise<{ updated: number; skipped: number }> {
    const orders = await this.orderModel
      .find({ $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }] })
      .sort({ createdAt: 1 })
      .select('_id createdAt')
      .lean()
      .exec();

    if (orders.length === 0) {
      return { updated: 0, skipped: 0 };
    }

    const grouped = new Map<string, { _id: unknown; createdAt: Date }[]>();
    for (const order of orders) {
      const key = this.buildCounterKey(new Date(order.createdAt));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(order);
    }

    let updated = 0;
    for (const [counterKey, monthOrders] of grouped) {
      const counter = await this.counterModel.findOneAndUpdate(
        { key: counterKey },
        { $inc: { seq: monthOrders.length } },
        { new: true, upsert: true },
      );

      const startSeq = counter.seq - monthOrders.length + 1;

      const bulkOps = monthOrders.map((order, i) => ({
        updateOne: {
          filter: { _id: order._id, invoiceNumber: { $exists: false } },
          update: { $set: { invoiceNumber: this.buildInvoiceString(counterKey, startSeq + i) } },
        },
      }));

      const result = await this.orderModel.bulkWrite(bulkOps);
      updated += result.modifiedCount;
    }

    return { updated, skipped: orders.length - updated };
  }
}
