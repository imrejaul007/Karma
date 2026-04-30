// @ts-nocheck
// @ts-ignore
/**
 * ScoreHistory Model — daily KarmaScore snapshots
 *
 * Stores one record per user per day for trend analysis and history charts.
 * TTL index auto-deletes records older than 90 days.
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IScoreHistory extends Document {
  userId: mongoose.Types.ObjectId;
  date: Date; // UTC date, no time component
  rawScore: number;
  displayScore: number;
  components: {
    base: number;
    impact: number;
    relativeRank: number;
    trust: number;
    momentum: number;
  };
  band: string;
  percentile: number;
  trustGrade: string;
  momentumLabel: string;
  activeKarma: number;
  lifetimeKarma: number;
}

const ScoreHistorySchema = new Schema<IScoreHistory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true },
    rawScore: { type: Number, required: true, min: 300, max: 900 },
    displayScore: { type: Number, required: true, min: 300, max: 900 },
    components: {
      base: { type: Number, required: true },
      impact: { type: Number, required: true, min: 0, max: 250 },
      relativeRank: { type: Number, required: true, min: 0, max: 180 },
      trust: { type: Number, required: true, min: 0, max: 100 },
      momentum: { type: Number, required: true, min: 0, max: 70 },
    },
    band: { type: String, required: true },
    percentile: { type: Number, required: true, min: 0, max: 100 },
    trustGrade: { type: String, required: true },
    momentumLabel: { type: String, required: true },
    activeKarma: { type: Number, required: true, min: 0 },
    lifetimeKarma: { type: Number, required: true, min: 0 },
  },
  { timestamps: false, collection: 'score_history' },
);

// Compound unique index: one record per user per day
ScoreHistorySchema.index({ userId: 1, date: 1 }, { unique: true });

// TTL index: auto-delete records older than 90 days
ScoreHistorySchema.index({ date: 1 }, { expireAfterSeconds: 90 * 86400 });

export const ScoreHistory: Model<IScoreHistory> =
  mongoose.models.ScoreHistory ||
  mongoose.model<IScoreHistory>('ScoreHistory', ScoreHistorySchema);
