// -nocheck
// @ts-ignore
/**
 * PerkClaim Model — tracks when users redeem perks
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export type PerkClaimStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface IPerkClaim extends Document {
  userId: mongoose.Types.ObjectId;
  perkId: mongoose.Types.ObjectId;
  perkName: string;
  status: PerkClaimStatus;
  claimedAt: Date;
  usedAt?: Date;
  expiresAt: Date;
  redemptionCode?: string;
  merchantId?: mongoose.Types.ObjectId;
  usedForOrderId?: string;
  karmaScoreAtClaim: number;
  bandAtClaim: string;
}

const PerkClaimSchema = new Schema<IPerkClaim>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    perkId: { type: Schema.Types.ObjectId, ref: 'Perk', required: true, index: true },
    perkName: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'used', 'expired', 'revoked'] as PerkClaimStatus[],
      default: 'active',
    },
    claimedAt: { type: Date, default: Date.now },
    usedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    redemptionCode: { type: String },
    merchantId: { type: Schema.Types.ObjectId, ref: 'Merchant' },
    usedForOrderId: { type: String },
    karmaScoreAtClaim: { type: Number, required: true },
    bandAtClaim: { type: String, required: true },
  },
  { timestamps: false, collection: 'perk_claims' },
);

PerkClaimSchema.index({ userId: 1, perkId: 1 });
PerkClaimSchema.index({ userId: 1, status: 1 });
PerkClaimSchema.index({ status: 1, expiresAt: 1 });

export const PerkClaim: Model<IPerkClaim> =
  mongoose.models.PerkClaim || mongoose.model<IPerkClaim>('PerkClaim', PerkClaimSchema);
