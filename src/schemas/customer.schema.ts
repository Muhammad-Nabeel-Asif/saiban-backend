import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Customer extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  email: string;

  @Prop()
  streetAddress: string;

  @Prop()
  city: string;

  @Prop()
  state: string;

  @Prop({ default: '' })
  note: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
export type CustomerDocument = InferSchemaType<typeof CustomerSchema> & Document;
