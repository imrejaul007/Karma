// -nocheck
// @ts-ignore
/**
 * Intent Model - MongoDB Schema
 * Tracks loyalty/rewards intents for cross-app intelligence
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IIntentSignal {
  eventType: string;
  weight: number;
  data?: Record<string, unknown>;
  capturedAt: Date;
}

export interface IIntent extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  appType: string;
  category: string;
  intentKey: string;
  metadata?: Record<string, unknown>;
  confidence: number;
  status: 'ACTIVE' | 'DORMANT' | 'FULFILLED' | 'EXPIRED';
  firstSeenAt: Date;
  lastSeenAt: Date;
  signals: IIntentSignal[];
}

// ── Schema ────────────────────────────────────────────────────────────────────

const IntentSignalSchema = new Schema<IIntentSignal>({
  eventType: { type: String, required: true },
  weight: { type: Number, required: true, min: 0, max: 1 },
  data: { type: Schema.Types.Mixed },
  capturedAt: { type: Date, default: Date.now }
}, { _id: false });

const IntentSchema = new Schema<IIntent>({
  userId: { type: String, required: true, index: true },
  appType: { type: String, required: true, index: true },
  category: { type: String, required: true, index: true },
  intentKey: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  confidence: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
  status: {
    type: String,
    enum: ['ACTIVE', 'DORMANT', 'FULFILLED', 'EXPIRED'],
    default: 'ACTIVE',
    index: true
  },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  signals: [IntentSignalSchema]
}, {
  timestamps: false,
  versionKey: false
});

// Compound indexes
IntentSchema.index({ userId: 1, appType: 1, intentKey: 1 }, { unique: true });
IntentSchema.index({ userId: 1, status: 1 });
IntentSchema.index({ status: 1, lastSeenAt: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const Intent: Model<IIntent> = mongoose.model<IIntent>('Intent', IntentSchema);
export default Intent;
