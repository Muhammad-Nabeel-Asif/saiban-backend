import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Product extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  shortDescription: string;

  @Prop()
  descriptionUrdu: string;

  @Prop({ required: true, trim: true })
  formulation: string;

  @Prop({ required: true, trim: true })
  packType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true, min: 0 })
  unitPrice: number;

  @Prop()
  gstPercent: number;

  @Prop({ default: 10 })
  lowStockThreshold: number;

  @Prop({ default: 0 })
  quantityInStock: number;

  @Prop()
  batchNo?: string;

  @Prop()
  expiry?: string;

  @Prop()
  mfg?: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ userId: 1, name: 1 }, { unique: true });
export type ProductDocument = InferSchemaType<typeof ProductSchema> & Document;
