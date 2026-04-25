import mongoose, { Schema, Document, Model } from 'mongoose';
import type { KarmaLevel as Level } from '@rez/shared-types';

export interface KarmaProfileDocument extends Omit<IKarmaProfile, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface IBadge {
  id: string;
  name: string;
  earnedAt: Date;
}

export interface ILevelHistoryEntry {
  level: Level;
  earnedAt: Date;
  droppedAt?: Date;
  // G-KS-M1 FIX: Add reason field to track why level changed.
  reason?: string;
}

export interface IConversionHistoryEntry {
  karmaConverted: number;
  coinsEarned: number;
  rate: number;
  batchId: mongoose.Types.ObjectId;
  convertedAt: Date;
}

export interface IKarmaProfile {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  lifetimeKarma: number;
  activeKarma: number;
  level: Level;
  eventsCompleted: number;
  eventsJoined: number;
  totalHours: number;
  trustScore: number;
  badges: IBadge[];
  lastActivityAt: Date;
  levelHistory: ILevelHistoryEntry[];
  conversionHistory: IConversionHistoryEntry[];
  thisWeekKarmaEarned: number;
  weekOfLastKarmaEarned?: Date;
  avgEventDifficulty: number;
  avgConfidenceScore: number;
  checkIns: number;
  approvedCheckIns: number;
  activityHistory: Date[];
  createdAt: Date;
  updatedAt: Date;
  // G-KS-A1 FIX: Track when decay was last applied to prevent double-decay.
  lastDecayAppliedAt?: Date;
  // G-KS-M32 FIX: Store user's timezone for decay calculations.
  userTimezone?: string;
  // Phase 4: Category-specific event counts for mission/badge tracking
  environmentEvents: number;
  foodEvents: number;
  healthEvents: number;
  educationEvents: number;
  communityEvents: number;
  hardEvents: number;
  uniqueCategories: string[];
  // Streak tracking for mission/badge evaluation
  currentStreak: number;
  longestStreak: number;
  lastStreakUpdatedAt?: Date;
  // FCM token for push notifications (legacy - prefer UserDevice model)
  fcmToken?: string;
}

const BadgeSchema = new Schema<IBadge>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    earnedAt: { type: Date, required: true },
  },
  { _id: false },
);

const LevelHistoryEntrySchema = new Schema<ILevelHistoryEntry>(
  {
    level: { type: String, enum: ['L1', 'L2', 'L3', 'L4'] as Level[], required: true },
    earnedAt: { type: Date, required: true },
    droppedAt: { type: Date },
    // G-KS-M1 FIX: Add reason field to track why level changed.
    reason: { type: String },
  },
  { _id: false },
);

const ConversionHistoryEntrySchema = new Schema<IConversionHistoryEntry>(
  {
    karmaConverted: { type: Number, required: true, min: 0 },
    coinsEarned: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0, max: 1 },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    convertedAt: { type: Date, required: true },
  },
  { _id: false },
);

const KarmaProfileSchema = new Schema<KarmaProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    lifetimeKarma: { type: Number, default: 0, min: 0 },
    activeKarma: { type: Number, default: 0, min: 0 },
    level: {
      type: String,
      enum: ['L1', 'L2', 'L3', 'L4'] as Level[],
      default: 'L1',
    },
    eventsCompleted: { type: Number, default: 0, min: 0 },
    eventsJoined: { type: Number, default: 0, min: 0 },
    totalHours: { type: Number, default: 0, min: 0 },
    trustScore: { type: Number, default: 0, min: 0, max: 100 },
    badges: { type: [BadgeSchema], default: [] },
    lastActivityAt: { type: Date, default: null },
    levelHistory: { type: [LevelHistoryEntrySchema], default: [] },
    conversionHistory: { type: [ConversionHistoryEntrySchema], default: [] },
    thisWeekKarmaEarned: { type: Number, default: 0 },
    weekOfLastKarmaEarned: { type: Date },
    avgEventDifficulty: { type: Number, default: 0 },
    avgConfidenceScore: { type: Number, default: 0 },
    checkIns: { type: Number, default: 0 },
    approvedCheckIns: { type: Number, default: 0 },
    activityHistory: { type: [Date], default: [] },
    createdAt: { type: Date, default: Date.now },
    // G-KS-A1 FIX: Add lastDecayAppliedAt to schema.
    // applyDailyDecay reads/writes this field but it was missing from the schema,
    // causing it to be silently dropped by Mongoose.
    lastDecayAppliedAt: { type: Date },
    // G-KS-M32 FIX: Add userTimezone to schema.
    userTimezone: { type: String, default: 'UTC' },
    // Phase 4: Category-specific event counts for mission/badge tracking
    environmentEvents: { type: Number, default: 0, min: 0 },
    foodEvents: { type: Number, default: 0, min: 0 },
    healthEvents: { type: Number, default: 0, min: 0 },
    educationEvents: { type: Number, default: 0, min: 0 },
    communityEvents: { type: Number, default: 0, min: 0 },
    hardEvents: { type: Number, default: 0, min: 0 },
    uniqueCategories: { type: [String], default: [] },
    // Streak tracking for mission/badge evaluation
    currentStreak: { type: Number, default: 0, min: 0 },
    longestStreak: { type: Number, default: 0, min: 0 },
    lastStreakUpdatedAt: { type: Date },
    // FCM token for push notifications (legacy - prefer UserDevice model)
    fcmToken: { type: String },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'karma_profiles',
  },
);

// SCHEMA FIX: Add indexes for common query patterns
KarmaProfileSchema.index({ level: 1, createdAt: -1 });
// SCHEMA FIX: Index on nested conversionHistory.batchId for batch queries
KarmaProfileSchema.index({ 'conversionHistory.batchId': 1 }, { sparse: true });

export const KarmaProfile: Model<KarmaProfileDocument> =
  mongoose.models.KarmaProfile ||
  mongoose.model<KarmaProfileDocument>('KarmaProfile', KarmaProfileSchema);
