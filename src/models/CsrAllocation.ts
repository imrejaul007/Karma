// @ts-ignore
import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * CSR Allocation status values
 */
export type CsrAllocationStatus = 'pending' | 'approved' | 'rejected';

/**
 * CSR Allocation document interface
 * Tracks karma credit allocations from corporate partners to users
 */
export interface CsrAllocationDocument extends Omit<ICsRAllocation, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface ICsRAllocation {
  _id: mongoose.Types.ObjectId;
  corporatePartnerId: mongoose.Types.ObjectId;
  eventId: mongoose.Types.ObjectId;
  recipientUserId: mongoose.Types.ObjectId;
  amount: number;
  allocatedBy: string;
  allocatedAt: Date;
  status: CsrAllocationStatus;
}

const CsrAllocationSchema = new Schema<CsrAllocationDocument>(
  {
    corporatePartnerId: {
      type: Schema.Types.ObjectId,
      ref: 'CorporatePartner',
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'KarmaEvent',
      required: true,
      index: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    allocatedBy: {
      type: String,
      required: true,
      trim: true,
    },
    allocatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'] as CsrAllocationStatus[],
      default: 'pending',
      index: true,
    },
  },
  {
    timestamps: false,
    collection: 'csr_allocations',
  },
);

// Compound indexes for common query patterns
CsrAllocationSchema.index({ corporatePartnerId: 1, status: 1 });
CsrAllocationSchema.index({ recipientUserId: 1, allocatedAt: -1 });
CsrAllocationSchema.index({ corporatePartnerId: 1, allocatedAt: -1 });

export const CsrAllocation: Model<CsrAllocationDocument> =
  mongoose.models.CsrAllocation ||
  mongoose.model<CsrAllocationDocument>('CsrAllocation', CsrAllocationSchema);
