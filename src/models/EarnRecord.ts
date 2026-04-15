import mongoose, { Schema, Document, Model } from 'mongoose';
import type {
  EarnRecordStatus,
  Level,
  VerificationSignals,
} from '../types/index';

export interface EarnRecordDocument extends Omit<IEarnRecord, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface IEarnRecord {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  eventId: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  karmaEarned: number;
  activeLevelAtApproval: Level;
  conversionRateSnapshot: number;
  csrPoolId: mongoose.Types.ObjectId;
  verificationSignals: VerificationSignals;
  confidenceScore: number;
  status: EarnRecordStatus;
  createdAt: Date;
  approvedAt?: Date;
  convertedAt?: Date;
  convertedBy?: mongoose.Types.ObjectId;
  batchId?: mongoose.Types.ObjectId;
  rezCoinsEarned?: number;
  idempotencyKey: string;
}

const verificationSignalsSchema = new Schema<VerificationSignals>(
  {
    qr_in: { type: Boolean, default: false },
    qr_out: { type: Boolean, default: false },
    gps_match: { type: Number, default: 0 },
    ngo_approved: { type: Boolean, default: false },
    photo_proof: { type: Boolean, default: false },
  },
  { _id: false },
);

const EarnRecordSchema = new Schema<EarnRecordDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'EventBooking', required: true },
    karmaEarned: { type: Number, required: true, min: 0 },
    activeLevelAtApproval: {
      type: String,
      enum: ['L1', 'L2', 'L3', 'L4'] as Level[],
      required: true,
    },
    conversionRateSnapshot: { type: Number, required: true, min: 0, max: 1 },
    csrPoolId: { type: Schema.Types.ObjectId, ref: 'CSRPool', required: true },
    verificationSignals: { type: verificationSignalsSchema, required: true },
    confidenceScore: { type: Number, required: true, min: 0, max: 1 },
    status: {
      type: String,
      enum: [
        'APPROVED_PENDING_CONVERSION',
        'CONVERTED',
        'REJECTED',
        'ROLLED_BACK',
      ] as EarnRecordStatus[],
      default: 'APPROVED_PENDING_CONVERSION',
      index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
    approvedAt: { type: Date },
    convertedAt: { type: Date },
    convertedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', index: true },
    rezCoinsEarned: { type: Number, min: 0 },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
  },
  {
    timestamps: false,
    collection: 'earn_records',
  },
);

export const EarnRecord: Model<EarnRecordDocument> =
  mongoose.models.EarnRecord ||
  mongoose.model<EarnRecordDocument>('EarnRecord', EarnRecordSchema);
