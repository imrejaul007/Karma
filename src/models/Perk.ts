// @ts-ignore
/**
 * Perk Model — rewards unlocked by KarmaScore bands
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export type PerkType = 'discount' | 'upgrade' | 'access' | 'cashback' | 'coin_bonus';

export interface IPerk extends Document {
  name: string;
  description: string;
  perkType: PerkType;
  minKarmaScore: number; // min KarmaScore to unlock
  requiredBand: string;  // e.g. 'performer', 'leader'
  value: number;         // e.g. 10 for 10% discount, 50 for 50 bonus coins
  currency?: string;      // 'INR' for discounts, 'coins' for coin_bonus
  merchantIds: mongoose.Types.ObjectId[];
  categories: string[];
  maxClaims?: number;    // total claim limit
  claimsUsed: number;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  createdAt: Date;
}

const PerkSchema = new Schema<IPerk>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    perkType: {
      type: String,
      enum: ['discount', 'upgrade', 'access', 'cashback', 'coin_bonus'] as PerkType[],
      required: true,
    },
    minKarmaScore: { type: Number, required: true, min: 300, max: 900 },
    requiredBand: { type: String, required: true },
    value: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    merchantIds: { type: [Schema.Types.ObjectId], ref: 'Merchant', default: [] },
    categories: { type: [String], default: [] },
    maxClaims: { type: Number },
    claimsUsed: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'perks',
  },
);

PerkSchema.index({ isActive: 1, validUntil: 1 });
PerkSchema.index({ requiredBand: 1, minKarmaScore: 1 });

export const Perk: Model<IPerk> =
  mongoose.models.Perk || mongoose.model<IPerk>('Perk', PerkSchema);
