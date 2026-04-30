// @ts-nocheck
// @ts-ignore
/**
 * Green Score Profile Model — Environmental impact tracking for NBKC
 *
 * Tracks environmental actions contributing to the Green Bengaluru Score.
 */
import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type GreenActionType =
  | 'tree_adoption'
  | 'lake_cleanup'
  | 'composting'
  | 'waste_segregation'
  | 'plastic_cleanup'
  | 'sapling_planting'
  | 'water_conservation'
  | 'energy_saving';

export interface IGreenAction {
  actionType: GreenActionType;
  performedAt: Date;
  karmaEarned: number;
  ward: string;
  verified: boolean;
}

export interface IGreenScoreProfile {
  userId: Types.ObjectId;
  environmentalPoints: number;
  greenScore: number; // 0-100
  greenBengaluruScore: number; // specialized 0-100 sub-score
  actionsPerformed: number;
  missionsCompleted: number;
  lastActionAt?: Date;
  actionHistory: IGreenAction[];
  // Breakdown components
  treePoints: number;
  waterPoints: number;
  wastePoints: number;
  energyPoints: number;
}

export interface GreenScoreProfileDocument extends Omit<IGreenScoreProfile, 'userId'>, Document {
  userId: Types.ObjectId;
  computeGreenScore(): number;
  computeGreenBengaluruScore(): number;
}

const GreenActionSchema = new Schema<IGreenAction>(
  {
    actionType: {
      type: String,
      enum: [
        'tree_adoption',
        'lake_cleanup',
        'composting',
        'waste_segregation',
        'plastic_cleanup',
        'sapling_planting',
        'water_conservation',
        'energy_saving',
      ] as GreenActionType[],
      required: true,
    },
    performedAt: { type: Date, default: Date.now },
    karmaEarned: { type: Number, default: 0 },
    ward: { type: String, default: '' },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const GreenScoreProfileSchema = new Schema<GreenScoreProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    environmentalPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    greenScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    greenBengaluruScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    actionsPerformed: {
      type: Number,
      default: 0,
      min: 0,
    },
    missionsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastActionAt: {
      type: Date,
    },
    actionHistory: {
      type: [GreenActionSchema],
      default: [],
    },
    treePoints: { type: Number, default: 0 },
    waterPoints: { type: Number, default: 0 },
    wastePoints: { type: Number, default: 0 },
    energyPoints: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'green_score_profiles',
  },
);

// Keep action history bounded (last 100 actions)
GreenScoreProfileSchema.pre('save', function (next) {
  if (this.actionHistory.length > 100) {
    this.actionHistory = this.actionHistory.slice(-100);
  }
  next();
});

// Compute greenScore from environmentalPoints
// Scale: 0-500 points = 0-50 score, 500-2000 = 50-90, 2000+ = 90-100
GreenScoreProfileSchema.methods.computeGreenScore = function (): number {
  const pts = this.environmentalPoints;
  if (pts <= 500) return Math.round((pts / 500) * 50);
  if (pts <= 2000) return Math.round(50 + ((pts - 500) / 1500) * 40);
  return Math.min(100, Math.round(90 + ((pts - 2000) / 3000) * 10));
};

// Compute Green Bengaluru Score (environmental sub-score)
GreenScoreProfileSchema.methods.computeGreenBengaluruScore = function (): number {
  // Weighted: tree actions (30%), water (25%), waste (25%), energy (20%)
  const treeScore = Math.min(100, (this.treePoints / 100) * 100) * 0.3;
  const waterScore = Math.min(100, (this.waterPoints / 80) * 100) * 0.25;
  const wasteScore = Math.min(100, (this.wastePoints / 80) * 100) * 0.25;
  const energyScore = Math.min(100, (this.energyPoints / 60) * 100) * 0.2;
  return Math.round(treeScore + waterScore + wasteScore + energyScore);
};

// Static: get global green leaders
GreenScoreProfileSchema.statics.getTopPerformers = function (limit = 10) {
  return this.find().sort({ greenBengaluruScore: -1 }).limit(limit).select('userId greenBengaluruScore environmentalPoints');
};

// Static: get ward leaders
GreenScoreProfileSchema.statics.getWardLeaders = async function (ward: string, limit = 10) {
  // Requires joining with membership data — use aggregate
  return this.aggregate([
    { $lookup: { from: 'nbkc_memberships', localField: 'userId', foreignField: 'userId', as: 'membership' } },
    { $unwind: { path: '$membership', preserveNullAndEmptyArrays: false } },
    { $match: { 'membership.ward': ward, 'membership.isActive': true } },
    { $sort: { greenBengaluruScore: -1 } },
    { $limit: limit },
    { $project: { userId: 1, greenBengaluruScore: 1, environmentalPoints: 1 } },
  ]);
};

export const GreenScoreProfile: Model<GreenScoreProfileDocument> =
  mongoose.models.GreenScoreProfile ||
  mongoose.model<GreenScoreProfileDocument>('GreenScoreProfile', GreenScoreProfileSchema);
