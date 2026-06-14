import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, InferSchemaType } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop()
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: 'admin' })
  role: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpires?: Date;

  @Prop({ default: 0 })
  tokenVersion: number;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
export type UserDocument = InferSchemaType<typeof UserSchema> & Document;
