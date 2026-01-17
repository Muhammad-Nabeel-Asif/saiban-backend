import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType, Types } from 'mongoose';
import { PaymentMethod } from './schema.types';

@Schema({ timestamps: true })
export class Payment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId | null;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Prop()
  reference: string;

  @Prop()
  note: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
export type PaymentDocument = InferSchemaType<typeof PaymentSchema> & Document;
