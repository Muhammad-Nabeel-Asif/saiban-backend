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

  @Prop({ min: 0, max: 100, default: 0 })
  discountPercentage: number;

  @Prop({ min: 0, default: 0 })
  discountAmount: number;

  @Prop({ required: true, min: 0 })
  lineTotal: number;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
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

  @Prop({ required: true, min: 0 })
  grandTotal: number;

  @Prop({ unique: true, sparse: true })
  invoiceNumber?: string;

  @Prop()
  note?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

export type OrderSchemaDocument = Order & Document;

OrderSchema.pre('validate', function () {
  let subtotal = 0;
  let totalDiscount = 0;

  for (const item of this.items) {
    const gross = roundMoney(item.unitPrice * item.quantity);

    const discount = roundMoney(gross * ((item.discountPercentage ?? 0) / 100));

    // Store the calculated discount amount
    item.discountAmount = discount;
    totalDiscount = roundMoney(totalDiscount + discount);

    item.lineTotal = roundMoney(Math.max(gross - discount, 0));

    subtotal = roundMoney(subtotal + item.lineTotal);
  }

  this.subtotal = roundMoney(subtotal);

  this.discountTotal = roundMoney(totalDiscount);

  this.grandTotal = roundMoney(subtotal);
});
