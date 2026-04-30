// -nocheck
// @ts-ignore
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { CSRPoolStatus } from '../shared-types';

export interface CSRPoolDocument extends Omit<ICSRPool, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface ICSRPool {
  _id: mongoose.Types.ObjectId;
  name: string;
  campaignId: mongoose.Types.ObjectId;
  corporateId: mongoose.Types.ObjectId;
  totalBudget: number;
  remainingBudget: number;
  coinPool: number;
  coinPoolRemaining: number;
  issuedCoins: number;
  status: CSRPoolStatus;
  startDate: Date;
  endDate: Date;
  events: mongoose.Types.ObjectId[];
  createdAt: Date;
}

const CSRPoolSchema = new Schema<CSRPoolDocument>(
  {
    name: { type: String, required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    corporateId: { type: Schema.Types.ObjectId, ref: 'CorporateAccount', required: true, index: true },
    totalBudget: { type: Number, required: true, min: 0 },
    remainingBudget: { type: Number, default: 0, min: 0 },
    coinPool: { type: Number, required: true, min: 0 },
    coinPoolRemaining: { type: Number, default: 0, min: 0 },
    issuedCoins: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'depleted', 'expired'] as CSRPoolStatus[],
      default: 'active',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    events: [{ type: Schema.Types.ObjectId, ref: 'Event' }],
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'csr_pools',
  },
);

export const CSRPool: Model<CSRPoolDocument> =
  mongoose.models.CSRPool ||
  mongoose.model<CSRPoolDocument>('CSRPool', CSRPoolSchema);
