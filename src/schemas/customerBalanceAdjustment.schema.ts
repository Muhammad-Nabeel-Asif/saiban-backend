import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType, Types } from 'mongoose';
import { BalanceDirection } from './schema.types';

@Schema({ timestamps: true })
export class CustomerBalanceAdjustment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, enum: BalanceDirection })
  direction: BalanceDirection;

  @Prop()
  note?: string;
}

export const CustomerBalanceAdjustmentSchema = SchemaFactory.createForClass(CustomerBalanceAdjustment);
export type CustomerBalanceAdjustmentDocument =
  InferSchemaType<typeof CustomerBalanceAdjustmentSchema> & Document;
