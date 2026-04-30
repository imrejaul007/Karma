// @ts-nocheck
// @ts-ignore
/**
 * Civic Mission Model — NBKC volunteer missions
 *
 * Tracks civic participation missions (tree planting, lake cleanup, etc.).
 */
import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type CivicMissionCategory =
  | 'environment'
  | 'water'
  | 'waste'
  | 'civic'
  | 'community';

export type CivicMissionStatus = 'active' | 'completed' | 'cancelled' | 'archived';

export type CivicMissionDifficulty = 'easy' | 'moderate' | 'challenging';

export interface ICivicMission {
  title: string;
  description: string;
  category: CivicMissionCategory;
  difficulty: CivicMissionDifficulty;
  ward: string;
  location: string;
  coordinates?: { lat: number; lng: number };
  scheduledAt: Date;
  durationHours: number;
  maxVolunteers: number;
  currentVolunteers: number;
  karmaReward: number;
  greenScoreReward: number;
  status: CivicMissionStatus;
  organizerName: string;
  organizerContact: string;
  requirements: string[];
  whatToBring: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICivicMissionEnrollment {
  _id: Types.ObjectId;
  missionId: Types.ObjectId;
  userId: Types.ObjectId;
  enrolledAt: Date;
  checkedInAt?: Date;
  completedAt?: Date;
  hoursVolunteered: number;
  karmaEarned: number;
  greenScoreEarned: number;
  verified: boolean;
  feedback?: string;
}

export interface CivicMissionDocument extends Omit<ICivicMission, '_id'>, Document {}

export interface CivicMissionEnrollmentDocument extends Omit<ICivicMissionEnrollment, '_id'>, Document {}

const CivicMissionSchema = new Schema<CivicMissionDocument>(
  {
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 1000 },
    category: {
      type: String,
      enum: ['environment', 'water', 'waste', 'civic', 'community'] as CivicMissionCategory[],
      required: true,
      index: true,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'moderate', 'challenging'] as CivicMissionDifficulty[],
      default: 'easy',
    },
    ward: { type: String, required: true, index: true },
    location: { type: String, required: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    scheduledAt: { type: Date, required: true, index: true },
    durationHours: { type: Number, required: true, min: 0.5, max: 24 },
    maxVolunteers: { type: Number, required: true, min: 1 },
    currentVolunteers: { type: Number, default: 0, min: 0 },
    karmaReward: { type: Number, required: true, min: 0 },
    greenScoreReward: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled', 'archived'] as CivicMissionStatus[],
      default: 'active',
      index: true,
    },
    organizerName: { type: String, required: true },
    organizerContact: { type: String, required: true },
    requirements: { type: [String], default: [] },
    whatToBring: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'civic_missions',
  },
);

CivicMissionSchema.index({ ward: 1, status: 1, scheduledAt: 1 });
CivicMissionSchema.index({ category: 1, status: 1 });

// Pre-save: clamp currentVolunteers to maxVolunteers
CivicMissionSchema.pre('save', function (next) {
  if (this.currentVolunteers > this.maxVolunteers) {
    this.currentVolunteers = this.maxVolunteers;
  }
  next();
});

// Static: get upcoming missions by ward
CivicMissionSchema.statics.getUpcomingByWard = function (ward: string, limit = 20) {
  return this.find({
    ward,
    status: 'active',
    scheduledAt: { $gte: new Date() },
  })
    .sort({ scheduledAt: 1 })
    .limit(limit);
};

// Static: get missions by category
CivicMissionSchema.statics.getByCategory = function (
  category: CivicMissionCategory,
  limit = 20
) {
  return this.find({ category, status: 'active', scheduledAt: { $gte: new Date() } })
    .sort({ scheduledAt: 1 })
    .limit(limit);
};

const CivicMissionEnrollmentSchema = new Schema<CivicMissionEnrollmentDocument>({
  missionId: {
    type: Schema.Types.ObjectId,
    ref: 'CivicMission',
    required: true,
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  enrolledAt: { type: Date, default: Date.now },
  checkedInAt: { type: Date },
  completedAt: { type: Date },
  hoursVolunteered: { type: Number, default: 0, min: 0 },
  karmaEarned: { type: Number, default: 0, min: 0 },
  greenScoreEarned: { type: Number, default: 0, min: 0 },
  verified: { type: Boolean, default: false },
  feedback: { type: String, maxlength: 500 },
});

// Unique enrollment per user per mission
CivicMissionEnrollmentSchema.index({ missionId: 1, userId: 1 }, { unique: true });

export const CivicMission: Model<CivicMissionDocument> =
  mongoose.models.CivicMission ||
  mongoose.model<CivicMissionDocument>('CivicMission', CivicMissionSchema);

export const CivicMissionEnrollment: Model<CivicMissionEnrollmentDocument> =
  mongoose.models.CivicMissionEnrollment ||
  mongoose.model<CivicMissionEnrollmentDocument>(
    'CivicMissionEnrollment',
    CivicMissionEnrollmentSchema
  );
