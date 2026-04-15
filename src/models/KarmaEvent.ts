import mongoose, { Schema, Document, Model } from 'mongoose';
import type { EventCategory, EventDifficulty, KarmaEventStatus } from '../types/index';

export interface KarmaEventDocument extends Omit<IKarmaEvent, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface IQRCodeSet {
  checkIn: string;
  checkOut: string;
}

export interface IKarmaEvent {
  _id: mongoose.Types.ObjectId;
  merchantEventId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  category: EventCategory;
  impactUnit: string;
  impactMultiplier: number;
  difficulty: EventDifficulty;
  expectedDurationHours: number;
  baseKarmaPerHour: number;
  maxKarmaPerEvent: number;
  qrCodes: IQRCodeSet;
  gpsRadius: number;
  maxVolunteers: number;
  confirmedVolunteers: number;
  status: KarmaEventStatus;
  createdAt: Date;
  updatedAt: Date;
}

const qrCodesSchema = new Schema<IQRCodeSet>(
  {
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
  },
  { _id: false },
);

const KarmaEventSchema = new Schema<KarmaEventDocument>(
  {
    merchantEventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    // SCHEMA FIX: Field validation note - Mongoose does not enforce ref constraints at DB level.
    // Service-level validation in controllers/services must verify Event and Merchant documents exist.
    ngoId: { type: Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    category: {
      type: String,
      enum: ['environment', 'food', 'health', 'education', 'community'] as EventCategory[],
      required: true,
    },
    impactUnit: { type: String, required: true },
    impactMultiplier: { type: Number, default: 1.0, min: 0 },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'] as EventDifficulty[],
      required: true,
    },
    expectedDurationHours: { type: Number, required: true, min: 0 },
    baseKarmaPerHour: { type: Number, required: true, min: 0 },
    maxKarmaPerEvent: { type: Number, required: true, min: 0 },
    qrCodes: { type: qrCodesSchema, required: true },
    gpsRadius: { type: Number, default: 100, min: 0 },
    maxVolunteers: { type: Number, default: 50, min: 1 },
    confirmedVolunteers: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['draft', 'published', 'ongoing', 'completed', 'cancelled'] as KarmaEventStatus[],
      default: 'draft',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'karma_events',
  },
);

export const KarmaEvent: Model<KarmaEventDocument> =
  mongoose.models.KarmaEvent ||
  mongoose.model<KarmaEventDocument>('KarmaEvent', KarmaEventSchema);
