import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../../schemas/order.schema';
import { Product } from '../../schemas/product.schema';
import { CreateOrderDto, OrderQueryDto } from './order.dto';
import {
  EntryType,
  OrderStatus,
  PaymentMethod,
  SourceType,
  StockMovementReason,
} from '../../schemas/schema.types';
import { StockMovement } from '../../schemas/stockMovement.schema';
import { LedgerEntry } from '../../schemas/ledgerEntry.schema';
import { Payment } from '../../schemas/payment.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(StockMovement.name) private stockMovementModel: Model<StockMovement>,
    @InjectModel(LedgerEntry.name) private ledgerEntryModel: Model<LedgerEntry>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
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
          lineTotal: 0, // schema pre-hook will calculate
        };
      });

      // 4. Create order with PENDING status
      const order = new this.orderModel({
        customerId: dto.customerId,
        status: OrderStatus.PENDING,
        paymentMethod: dto.paymentMethod,
        items,
        note: dto.note,
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
        sourceId: order._id,
      });

      await ledgerEntry.save({ session });

      // 7. Handle payment based on payment method
      if (dto.paymentMethod !== PaymentMethod.ON_ACCOUNT) {
        // For non-account payments, record payment immediately
        const payment = new this.paymentModel({
          customerId: dto.customerId,
          orderId: order._id,
          amount: order.grandTotal,
          paymentMethod: dto.paymentMethod,
          reference: dto.paymentReference,
          note: 'Payment at order creation',
        });

        await payment.save({ session });

        // Create corresponding ledger entry (CREDIT)
        const paymentLedgerEntry = new this.ledgerEntryModel({
          customerId: dto.customerId,
          entryType: EntryType.CREDIT,
          amount: order.grandTotal,
          sourceType: SourceType.PAYMENT,
          sourceId: payment._id,
        });

        await paymentLedgerEntry.save({ session });
      }

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

    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .populate('customerId', 'firstName lastName email')
        .populate('items.productId', '')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
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

    // Stock was already deducted at order creation, just update status
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

      order.status = OrderStatus.CANCELLED;
      await order.save({ session });

      // Reverse stock
      const stockReversal = order.items.map((item) => ({
        productId: item.productId,
        quantityChange: item.quantity,
        reason: StockMovementReason.RETURN,
        referenceId: order._id,
      }));
      await this.stockMovementModel.insertMany(stockReversal, { session });

      // Reverse ledger
      const ledgerReversal = new this.ledgerEntryModel({
        customerId: order.customerId,
        entryType: EntryType.CREDIT,
        amount: order.grandTotal,
        sourceType: SourceType.ORDER,
        sourceId: order._id,
      });
      await ledgerReversal.save({ session });

      await session.commitTransaction();
      await session.endSession();

      return order;
    } catch (err) {
      await session.abortTransaction();
      await session.endSession();
      throw err;
    }
  }

  async findOne(id: string) {
    const order = await this.orderModel
      .findById(id)
      .populate('customerId', 'firstName lastName email phoneNumber')
      .populate('items.productId', '');

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async getOrderSummary(orderId: string) {
    const order = await this.orderModel.findById(orderId).lean();

    if (!order) throw new NotFoundException('Order not found');

    const subtotal = order.items.reduce((sum, i) => sum + i.lineTotal, 0);

    return {
      subtotal,
      discountTotal: order.discountTotal ?? 0,
      gstTotal: order.gstTotal ?? 0,
      grandTotal: order.grandTotal ?? subtotal - (order.discountTotal ?? 0) + (order.gstTotal ?? 0),
    };
  }

  async getOrdersReport(start: Date, end: Date) {
    const orders = await this.orderModel.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $project: {
          subtotal: 1,
          discountTotal: 1,
          gstTotal: 1,
          grandTotal: 1,
          status: 1,
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          subtotal: { $sum: '$subtotal' },
          discountTotal: { $sum: '$discountTotal' },
          gstTotal: { $sum: '$gstTotal' },
          grandTotal: { $sum: '$grandTotal' },
        },
      },
      { $project: { _id: 0 } },
    ]);

    return orders.length
      ? orders[0]
      : { totalOrders: 0, subtotal: 0, discountTotal: 0, gstTotal: 0, grandTotal: 0 };
  }
}
