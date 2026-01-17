import { Document, InferSchemaType, Types } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { StockMovementReason } from './schema.types';

@Schema({ timestamps: true })
export class StockMovement extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  quantityChange: number;

  @Prop({ enum: StockMovementReason, required: true })
  reason: string;

  @Prop({ type: Types.ObjectId })
  referenceId: Types.ObjectId;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
export type StockMovementDocument = InferSchemaType<typeof StockMovementSchema> & Document;
