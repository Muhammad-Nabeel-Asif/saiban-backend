import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OrderStatus, PaymentMethod } from './schema.types';

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

  @Prop({ type: String, required: true, enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ min: 0, default: 0 })
  discountTotal: number;

  @Prop({ min: 0, default: 0 })
  gstTotal: number;

  @Prop({ required: true, min: 0 })
  grandTotal: number;

  @Prop()
  note?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

export type OrderSchemaDocument = Order & Document;

OrderSchema.pre('validate', function () {
  let subtotal = 0;

  for (const item of this.items) {
    const gross = item.unitPrice * item.quantity;

    const discount = gross * ((item.discountPercentage ?? 0) / 100);

    item.lineTotal = Math.max(gross - discount, 0);

    subtotal += item.lineTotal;
  }

  this.subtotal = subtotal;

  const discountTotal = this.discountTotal ?? 0;
  const taxableAmount = Math.max(subtotal - discountTotal, 0);

  const gstTotal = this.gstTotal ?? 0;

  this.grandTotal = taxableAmount + gstTotal;
});
