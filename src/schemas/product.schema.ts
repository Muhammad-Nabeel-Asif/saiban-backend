import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType } from 'mongoose';
import { PackType, ProductFormulation } from './schema.types';

@Schema({ timestamps: true })
export class Product extends Document {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop()
  shortDescription: string;

  @Prop()
  descriptionUrdu: string;

  @Prop({ required: true, enum: ProductFormulation })
  formulation: string;

  @Prop({ required: true, enum: PackType })
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
}

export const ProductSchema = SchemaFactory.createForClass(Product);
export type ProductDocument = InferSchemaType<typeof ProductSchema> & Document;
