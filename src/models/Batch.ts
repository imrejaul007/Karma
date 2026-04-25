import mongoose, { Schema, Document, Model } from 'mongoose';
import type { BatchStatus } from '@rez/shared-types';

export interface BatchDocument extends Omit<IBatch, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface IAnomalyFlag {
  type: 'too_many_from_one_ngo' | 'suspicious_timestamps' | 'pool_shortage';
  count: number;
  resolved: boolean;
}

export interface IBatch {
  _id: mongoose.Types.ObjectId;
  weekStart: Date;
  weekEnd: Date;
  csrPoolId: mongoose.Types.ObjectId;
  totalEarnRecords: number;
  totalKarma: number;
  totalRezCoinsEstimated: number;
  totalRezCoinsExecuted: number;
  status: BatchStatus;
  anomalyFlags: IAnomalyFlag[];
  executedAt?: Date;
  executedBy?: mongoose.Types.ObjectId;
  pauseReason?: string;
  pausedAt?: Date;
  createdAt: Date;
}

const anomalyFlagSchema = new Schema<IAnomalyFlag>(
  {
    type: {
      type: String,
      enum: ['too_many_from_one_ngo', 'suspicious_timestamps', 'pool_shortage'],
      required: true,
    },
    count: { type: Number, default: 0, min: 0 },
    resolved: { type: Boolean, default: false },
  },
  { _id: false },
);

const BatchSchema = new Schema<BatchDocument>(
  {
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true },
    csrPoolId: { type: Schema.Types.ObjectId, ref: 'CSRPool', required: true },
    totalEarnRecords: { type: Number, default: 0, min: 0 },
    totalKarma: { type: Number, default: 0, min: 0 },
    totalRezCoinsEstimated: { type: Number, default: 0, min: 0 },
    totalRezCoinsExecuted: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['DRAFT', 'READY', 'EXECUTED', 'PARTIAL', 'PAUSED'] as BatchStatus[],
      default: 'DRAFT',
      index: true,
    },
    anomalyFlags: [anomalyFlagSchema],
    executedAt: { type: Date },
    executedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    pauseReason: { type: String },
    pausedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'batches',
  },
);

export const Batch: Model<BatchDocument> =
  mongoose.models.Batch ||
  mongoose.model<BatchDocument>('Batch', BatchSchema);
