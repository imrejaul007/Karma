// @ts-nocheck
// @ts-ignore
/**
 * NBKC Membership Model — Namma Bengaluru Karma Corps
 *
 * Tracks citizen membership in the civic participation program.
 */
import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type NBKCMembershipTier = 'citizen' | 'active' | 'civic_leader' | 'ambassador';

export interface INBKCMembership {
  userId: Types.ObjectId;
  memberNumber: string; // e.g. "NBKC-2026-00001"
  tier: NBKCMembershipTier;
  ward: string;
  skills: string[];
  hasVehicle: boolean;
  stickerIssued: boolean;
  stickerIssuedAt?: Date;
  joinedAt: Date;
  resignedAt?: Date;
  isActive: boolean;
  totalCivicHours: number;
  missionsCompleted: number;
  civicReportsVerified: number;
}

export interface NBKCMembershipDocument extends Omit<INBKCMembership, 'userId'>, Document {
  userId: Types.ObjectId;
  isEligibleForSticker(): boolean;
  getPerks(): string[];
}

export interface NBKCMembershipModel extends Model<NBKCMembershipDocument> {
  findByWard(ward: string): Promise<NBKCMembershipDocument[]>;
  getTierThresholds(): {
    active: { missionsCompleted: number; totalCivicHours: number };
    civic_leader: { missionsCompleted: number; totalCivicHours: number };
    ambassador: { missionsCompleted: number; totalCivicHours: number };
  };
}

const NBKCMembershipSchema = new Schema<NBKCMembershipDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    memberNumber: {
      type: String,
      required: true,
      unique: true,
    },
    tier: {
      type: String,
      enum: ['citizen', 'active', 'civic_leader', 'ambassador'] as NBKCMembershipTier[],
      default: 'citizen',
      index: true,
    },
    ward: {
      type: String,
      required: true,
      index: true,
    },
    skills: {
      type: [String],
      default: [],
    },
    hasVehicle: {
      type: Boolean,
      default: false,
    },
    stickerIssued: {
      type: Boolean,
      default: false,
    },
    stickerIssuedAt: {
      type: Date,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    resignedAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    totalCivicHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    missionsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },
    civicReportsVerified: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'nbkc_memberships',
  },
);

// Compound indexes for common queries
NBKCMembershipSchema.index({ tier: 1, ward: 1 });
NBKCMembershipSchema.index({ isActive: 1, tier: 1 });
NBKCMembershipSchema.index({ totalCivicHours: -1 });

// Pre-save: generate member number if new
NBKCMembershipSchema.pre('save', async function (next) {
  if (this.isNew && !this.memberNumber) {
    const count = await mongoose.models.NBKCMembership?.countDocuments() ?? 0;
    const year = new Date().getFullYear();
    this.memberNumber = `NBKC-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Static: find active members in a ward
NBKCMembershipSchema.statics.findByWard = function (ward: string) {
  return this.find({ ward, isActive: true }).sort({ totalCivicHours: -1 });
};

// Static: get tier thresholds
NBKCMembershipSchema.statics.getTierThresholds = function () {
  return {
    active: { missionsCompleted: 5, totalCivicHours: 10 },
    civic_leader: { missionsCompleted: 20, totalCivicHours: 50 },
    ambassador: { missionsCompleted: 50, totalCivicHours: 100 },
  } as const;
};

// Instance: check if eligible for sticker
NBKCMembershipSchema.methods.isEligibleForSticker = function (): boolean {
  if (this.stickerIssued) return false;
  if (!this.hasVehicle) return false;
  return this.missionsCompleted >= 3;
};

// Instance: get perks based on tier
NBKCMembershipSchema.methods.getPerks = function (): string[] {
  const perks: Record<NBKCMembershipTier, string[]> = {
    citizen: ['Digital civic ID', 'Corps membership badge', 'Access to civic missions'],
    active: [
      'Digital civic ID',
      'Corps membership badge',
      'Access to civic missions',
      'Vehicle sticker eligible',
      'Merchant partner perks',
    ],
    civic_leader: [
      'Digital civic ID',
      'Corps membership badge',
      'Access to civic missions',
      'Vehicle sticker',
      'Merchant partner perks',
      'Civic recognition certificates',
      'Exclusive civic leader events',
    ],
    ambassador: [
      'All active member perks',
      'Priority mission access',
      'Exclusive ambassador events',
      'BBMP partnership opportunities',
      'Featured on NBKC leaderboard',
    ],
  };
  return perks[this.tier as NBKCMembershipTier] ?? perks.citizen;
};

export const NBKCMembership: NBKCMembershipModel =
  (mongoose.models.NBKCMembership as NBKCMembershipModel) ||
  mongoose.model<NBKCMembershipDocument, NBKCMembershipModel>('NBKCMembership', NBKCMembershipSchema);
