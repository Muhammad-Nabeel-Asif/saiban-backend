import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../../schemas/order.schema';
import { Product } from '../../schemas/product.schema';
import { CreateOrderDto, OrderQueryDto } from './order.dto';
import {
  EntryType,
  OrderStatus,
  SourceType,
  StockMovementReason,
} from '../../schemas/schema.types';
import { StockMovement } from '../../schemas/stockMovement.schema';
import { LedgerEntry } from '../../schemas/ledgerEntry.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(StockMovement.name) private stockMovementModel: Model<StockMovement>,
    @InjectModel(LedgerEntry.name) private ledgerEntryModel: Model<LedgerEntry>,
  ) {}

  async create(dto: CreateOrderDto): Promise<any> {
    const session = await this.orderModel.db.startSession();
    session.startTransaction();

    try {
      // 1. Fetch product prices
      const productIds = dto.items.map((i) => i.productId);
      const products = await this.productModel.find({ _id: { $in: productIds } }).session(session);

      if (products.length !== productIds.length) {
        throw new BadRequestException('Some products not found');
      }

      const productMap: any = new Map(products.map((p) => [p._id.toString(), p]));

      // 2. Build Order Items (server-authoritative pricing)
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

      // 3. Create order
      const order = new this.orderModel({
        customerId: dto.customerId,
        status: OrderStatus.PENDING,
        paymentMethod: dto.paymentMethod,
        items,
        note: dto.note,
      });

      await order.save({ session });

      // 4. Stock Movements
      const stockMovements = items.map((item) => ({
        productId: item.productId,
        quantityChange: -item.quantity,
        reason: StockMovementReason.ORDER,
        referenceId: order._id,
      }));

      await this.stockMovementModel.insertMany(stockMovements, { session });

      // 5. Ledger Entry (DEBIT)
      const ledgerEntry = new this.ledgerEntryModel({
        customerId: dto.customerId,
        entryType: EntryType.DEBIT,
        amount: order.grandTotal,
        sourceType: SourceType.ORDER,
        sourceId: order._id,
      });

      await ledgerEntry.save({ session });

      await session.commitTransaction();
      await session.endSession();

      return order;
    } catch (err) {
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
    const order = await this.orderModel.findByIdAndUpdate(
      orderId,
      { status: OrderStatus.CONFIRMED },
      { new: true },
    );

    return {
      order,
      message: 'Order confirmed successfully',
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
}
