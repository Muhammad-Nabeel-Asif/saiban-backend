import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { roundMoney } from '../../common/utils/money.util';
import { toUserObjectId, userScopeFilter } from '../../common/utils/user-scope.util';

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

  async create(userId: string, dto: CreateOrderDto): Promise<any> {
    // Retry on duplicate invoiceNumber: the invoice counter is incremented
    // outside the transaction (so it always moves forward even when an attempt
    // aborts). If a collision still occurs — e.g. the counter has fallen behind
    // existing orders (legacy/imported data, manual edits) — we fast-forward the
    // counter to the current max and regenerate instead of failing.
    const MAX_ATTEMPTS = 8;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const session = await this.orderModel.db.startSession();
      session.startTransaction();

      try {
        const customer = await this.customerModel
          .findOne({ _id: dto.customerId, ...userScopeFilter(userId) })
          .session(session);
        if (!customer) {
          throw new NotFoundException('Customer not found');
        }

        // 1. Fetch product prices and validate stock
        const productIds = dto.items.map((i) => i.productId);
        const products = await this.productModel
          .find({ _id: { $in: productIds }, ...userScopeFilter(userId) })
          .session(session);

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
            costPrice: product.purchasePrice ?? 0, // snapshot supplier cost at order time
            discountPercentage: item.discountPercentage ?? 0,
            discountAmount: 0, // schema pre-hook will calculate
            lineTotal: 0, // schema pre-hook will calculate
            lineCost: 0, // schema pre-hook will calculate
          };
        });

        // 4. Create order with PENDING status
        const invoiceNumber = await this.generateInvoiceNumber(userId);

        const order = new this.orderModel({
          userId: toUserObjectId(userId),
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
          note: dto.note ?? null,
        });

        await ledgerEntry.save({ session });

        await session.commitTransaction();
        await session.endSession();
        return order;
      } catch (err) {
        await session.abortTransaction();
        await session.endSession();

        if (this.isDuplicateInvoiceError(err) && attempt < MAX_ATTEMPTS - 1) {
          // Self-heal: the counter is behind the real invoice numbers. Pull it
          // forward to the current max so the next attempt allocates an unused
          // number. Runs outside the (aborted) transaction.
          await this.syncInvoiceCounterToMax(userId);
          continue;
        }
        throw err;
      }
    }

    // Retries exhausted: surface a clean 409 instead of leaking a raw 500.
    throw new ConflictException(
      'Could not allocate a unique invoice number. Please retry the request.',
    );
  }

  /**
   * Detects a MongoDB duplicate-key (E11000) error on the
   * userId_1_invoiceNumber_1 unique index.
   */
  private isDuplicateInvoiceError(err: unknown): boolean {
    return this.isDuplicateKeyError(err, 'invoiceNumber');
  }

  /** Detects a MongoDB duplicate-key (E11000) error involving a given field. */
  private isDuplicateKeyError(err: unknown, field: string): boolean {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    return e?.code === 11000 && !!e?.keyPattern && field in e.keyPattern;
  }

  async findAll(userId: string, query: OrderQueryDto) {
    const { page = 1, limit = 10, search, status, customerId } = query;
    const filter: any = { ...userScopeFilter(userId) };

    // Handle customerId filter
    if (customerId) {
      const ownedCustomer = await this.customerModel
        .findOne({ _id: customerId, ...userScopeFilter(userId) })
        .select('_id')
        .lean()
        .exec();
      filter.customerId = ownedCustomer ? customerId : null;
    }
    // If search is provided, find matching customers first
    else if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingCustomers = await this.customerModel
        .find({
          ...userScopeFilter(userId),
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

  async confirmOrder(userId: string, orderId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, ...userScopeFilter(userId) });
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

  async cancelOrder(userId: string, orderId: string) {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findOne({ _id: orderId, ...userScopeFilter(userId) }).session(session);
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
        note: `Order cancelled: reversal for invoice ${order.invoiceNumber ?? String(order._id)}`,
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
          note: autoPayment.note ?? null,
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

  async returnOrder(userId: string, orderId: string) {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findOne({ _id: orderId, ...userScopeFilter(userId) }).session(session);
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
        note: `Order returned: reversal for invoice ${order.invoiceNumber ?? String(order._id)}`,
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
          note: autoPayment.note ?? null,
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

  async findOne(userId: string, id: string) {
    const order = await this.orderModel
      .findOne({ _id: id, ...userScopeFilter(userId) })
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

    const invoiceIssueAnchor = await this.getInvoiceIssueAnchorDate(
      String(order._id),
      (order as { createdAt?: Date }).createdAt,
    );
    const customerBalanceAtIssue = await this.ledgerService.getCustomerBalanceAsOf(
      userId,
      customerIdStr,
      invoiceIssueAnchor,
    );
    const customerIdNormalized = this.normalizeOrderCustomerSnapshot(rawCustomerId, customerIdStr);
    const invoiceBalanceSummary = this.buildInvoiceBalanceSummaryAtIssue(
      order.grandTotal,
      customerBalanceAtIssue.netBalance,
    );

    return {
      ...order,
      customerId: customerIdNormalized,
      invoiceBalanceSummary,
    };
  }

  private buildInvoiceBalanceSummaryAtIssue(orderGrandTotal: number, netBalanceAtIssue: number) {
    const currentOrderBill = roundMoney(orderGrandTotal);
    const orderBalanceImpact = roundMoney(currentOrderBill);
    const netPayable = roundMoney(netBalanceAtIssue);
    const previousBalance = roundMoney(netPayable - orderBalanceImpact);

    return {
      previousBalance: {
        amount: previousBalance,
        sign: this.getSignedSymbol(previousBalance),
        direction: this.getBalanceDirection(previousBalance),
        note: 'Balance before this order (snapshot at invoice issue time)',
      },
      currentOrderBill: {
        amount: currentOrderBill,
        sign: this.getSignedSymbol(orderBalanceImpact),
        balanceImpact: orderBalanceImpact,
        note: 'Current order bill impact at invoice issue time',
      },
      netPayable: {
        amount: netPayable,
        sign: this.getSignedSymbol(netPayable),
        direction: this.getBalanceDirection(netPayable),
        note: 'Balance right after this order was issued',
      },
      calculation: {
        previousBalance,
        orderImpact: orderBalanceImpact,
        netPayable,
        expression: `${this.toSignedCurrency(previousBalance)} ${this.operatorFor(orderBalanceImpact)} ${this.toSignedCurrency(Math.abs(orderBalanceImpact))} = ${this.toSignedCurrency(netPayable)}`,
      },
      legend: {
        positive: '+ means customer payable increased',
        negative: '- means customer has advance/credit',
        zero: '0 means fully settled',
      },
      basis: 'as_of_invoice_issue',
    };
  }

  private async getInvoiceIssueAnchorDate(
    orderId: string,
    orderCreatedAtFallback?: Date,
  ): Promise<Date> {
    const sourceIdMatch: any[] = [orderId];
    if (Types.ObjectId.isValid(orderId)) {
      sourceIdMatch.push(new Types.ObjectId(orderId));
    }

    const orderDebitEntry = await this.ledgerEntryModel
      .findOne({
        sourceType: SourceType.ORDER,
        sourceId: { $in: sourceIdMatch },
        entryType: EntryType.DEBIT,
      })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean<{ createdAt?: Date }>()
      .exec();

    if (orderDebitEntry?.createdAt) {
      return new Date(orderDebitEntry.createdAt);
    }

    if (orderCreatedAtFallback) {
      return new Date(orderCreatedAtFallback);
    }

    return new Date();
  }

  private getSignedSymbol(amount: number): '+' | '-' | '0' {
    if (amount > 0) return '+';
    if (amount < 0) return '-';
    return '0';
  }

  private getBalanceDirection(
    amount: number,
  ): 'customer_owes' | 'we_owe_customer' | 'settled' {
    if (amount > 0) return 'customer_owes';
    if (amount < 0) return 'we_owe_customer';
    return 'settled';
  }

  private operatorFor(amount: number): '+' | '-' {
    return amount >= 0 ? '+' : '-';
  }

  private toSignedCurrency(amount: number): string {
    const absolute = Math.abs(roundMoney(amount));
    const symbol = this.getSignedSymbol(amount);

    if (symbol === '0') {
      return 'Rs 0';
    }

    return `${symbol}Rs ${absolute}`;
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
  private buildCounterKey(userId: string, date: Date): string {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `invoice-${userId}-${yy}${mm}`;
  }

  private buildInvoiceString(counterKey: string, seq: number): string {
    const yyMm = counterKey.split('-').slice(-1)[0];
    return `INV-${yyMm}-${String(seq).padStart(4, '0')}`;
  }

  /**
   * Atomically reserves the next invoice sequence for the current month.
   *
   * IMPORTANT: this intentionally runs OUTSIDE the order transaction. A counter
   * must always move forward; if the increment were part of the transaction, an
   * aborted order would roll the counter back and the next attempt would keep
   * regenerating the same colliding invoice number forever.
   */
  private async generateInvoiceNumber(userId: string): Promise<string> {
    const key = this.buildCounterKey(userId, new Date());

    // findOneAndUpdate(upsert) can rarely throw E11000 on the counter's unique
    // `key` index when two concurrent requests create the same monthly counter
    // at once. Retrying resolves it: the doc then exists and we take the atomic
    // $inc path.
    const COUNTER_ATTEMPTS = 3;
    for (let attempt = 0; attempt < COUNTER_ATTEMPTS; attempt++) {
      try {
        const counter = await this.counterModel.findOneAndUpdate(
          { key },
          { $inc: { seq: 1 } },
          { returnDocument: 'after', upsert: true },
        );

        return this.buildInvoiceString(key, counter.seq);
      } catch (err) {
        if (this.isDuplicateKeyError(err, 'key') && attempt < COUNTER_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }

    // Unreachable in practice; keeps the return type total.
    throw new ConflictException('Could not allocate an invoice number.');
  }

  /**
   * Fast-forwards the current month's invoice counter so its seq is at least the
   * highest sequence already persisted for this user/month. Uses $max, so it
   * only ever moves the counter forward and is safe under concurrency. Called
   * when a duplicate invoiceNumber is detected so the counter "catches up" to
   * real data (e.g. legacy/imported orders the counter never accounted for).
   */
  private async syncInvoiceCounterToMax(userId: string): Promise<void> {
    const key = this.buildCounterKey(userId, new Date());
    const yyMm = key.split('-').slice(-1)[0];
    const prefix = `INV-${yyMm}-`;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Parse the numeric suffix from each matching invoice and take the true max.
    // Aggregation avoids relying on lexicographic ordering of zero-padded values.
    const result = await this.orderModel.aggregate<{ maxSeq: number }>([
      {
        $match: {
          ...userScopeFilter(userId),
          invoiceNumber: { $regex: `^${escapedPrefix}\\d+$` },
        },
      },
      {
        $project: {
          seq: { $toInt: { $substrBytes: ['$invoiceNumber', prefix.length, 16] } },
        },
      },
      { $group: { _id: null, maxSeq: { $max: '$seq' } } },
    ]);

    const maxSeq = result.length ? result[0].maxSeq : 0;
    if (!Number.isFinite(maxSeq) || maxSeq <= 0) {
      return;
    }

    await this.counterModel.updateOne({ key }, { $max: { seq: maxSeq } }, { upsert: true });
  }

  /**
   * Assigns invoice numbers to all existing orders that don't have one.
   * Uses each order's createdAt to place it in the correct monthly bucket.
   * Sorted by createdAt ascending so older orders get lower sequence numbers.
   */
  async backfillInvoiceNumbers(userId: string): Promise<{ updated: number; skipped: number }> {
    const orders = await this.orderModel
      .find({
        ...userScopeFilter(userId),
        $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }],
      })
      .sort({ createdAt: 1 })
      .select('_id createdAt')
      .lean<{ _id: unknown; createdAt: Date }[]>()
      .exec();

    if (orders.length === 0) {
      return { updated: 0, skipped: 0 };
    }

    const grouped = new Map<string, typeof orders>();
    for (const order of orders) {
      const key = this.buildCounterKey(userId, new Date(order.createdAt));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(order);
    }

    let updated = 0;
    for (const [counterKey, monthOrders] of grouped) {
      const counter = await this.counterModel.findOneAndUpdate(
        { key: counterKey },
        { $inc: { seq: monthOrders.length } },
        { returnDocument: 'after', upsert: true },
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
