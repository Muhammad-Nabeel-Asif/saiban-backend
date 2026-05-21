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

  @Prop({ type: String, required: true })
  sourceModel: string;

  @Prop({ type: Types.ObjectId, required: true, refPath: 'sourceModel' })
  sourceId: Types.ObjectId;

  @Prop()
  note?: string;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

export type LedgerEntryDocument = LedgerEntry & Document;
