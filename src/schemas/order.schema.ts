import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OrderStatus } from './schema.types';
import { roundMoney } from '../common/utils/money.util';

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  unitPrice: number;

  @Prop({ min: 0, default: 0 })
  costPrice: number;

  @Prop({ min: 0, max: 100, default: 0 })
  discountPercentage: number;

  @Prop({ min: 0, default: 0 })
  discountAmount: number;

  @Prop({ required: true, min: 0 })
  lineTotal: number;

  @Prop({ min: 0, default: 0 })
  lineCost: number;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: OrderStatus })
  status: OrderStatus;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ min: 0, default: 0 })
  discountTotal: number;

  @Prop({ min: 0, default: 0 })
  costTotal: number;

  @Prop({ default: 0 })
  profitTotal: number;

  @Prop({ required: true, min: 0 })
  grandTotal: number;

  @Prop({ sparse: true })
  invoiceNumber?: string;

  @Prop()
  note?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ status: 1, createdAt: 1 });
OrderSchema.index({ userId: 1, invoiceNumber: 1 }, { unique: true, sparse: true });

export type OrderSchemaDocument = Order & Document;

OrderSchema.pre('validate', function () {
  let subtotal = 0;
  let totalDiscount = 0;
  let costTotal = 0;

  for (const item of this.items) {
    const gross = roundMoney(item.unitPrice * item.quantity);

    const discount = roundMoney(gross * ((item.discountPercentage ?? 0) / 100));

    // Store the calculated discount amount
    item.discountAmount = discount;
    totalDiscount = roundMoney(totalDiscount + discount);

    item.lineTotal = roundMoney(Math.max(gross - discount, 0));

    // Snapshot cost: lineCost = costPrice * quantity (cost is locked at order time)
    item.lineCost = roundMoney((item.costPrice ?? 0) * item.quantity);
    costTotal = roundMoney(costTotal + item.lineCost);

    subtotal = roundMoney(subtotal + item.lineTotal);
  }

  this.subtotal = roundMoney(subtotal);

  this.discountTotal = roundMoney(totalDiscount);

  this.costTotal = roundMoney(costTotal);

  // Profit is computed against subtotal (ex-GST, net of discount), per spec.
  this.profitTotal = roundMoney(subtotal - costTotal);

  this.grandTotal = roundMoney(subtotal);
});
