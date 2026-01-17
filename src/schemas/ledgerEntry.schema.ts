import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { EntryType, SourceType } from './schema.types';

@Schema({ timestamps: true })
export class LedgerEntry {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: EntryType,
  })
  entryType: EntryType;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({
    type: String,
    required: true,
    enum: SourceType,
  })
  sourceType: SourceType;

  @Prop({ type: Types.ObjectId, required: true })
  sourceId: Types.ObjectId;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

export type LedgerEntryDocument = LedgerEntry & Document;
