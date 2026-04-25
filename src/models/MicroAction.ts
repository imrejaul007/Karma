/**
 * MicroAction Model — lightweight daily engagement tracking
 *
 * Stores one record per action completion per day.
 * Unique index on (userId, actionType, actionKey) ensures one completion per type+key per day.
 *
 * Design rationale:
 * - actionKey encodes the daily slot (e.g., "share_impact_2026-04-25")
 * - Queries filter by completedAt >= startOfToday() for fresh actions each day
 * - No separate midnight reset job needed
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export type MicroActionType =
  | 'share'
  | 'checkin'
  | 'referral'
  | 'profile'
  | 'community'
  | 'event'
  | 'streak';

export interface IMicroAction {
  userId: mongoose.Types.ObjectId;
  actionType: MicroActionType;
  actionKey: string;
  completedAt: Date;
  karmaBonus: number;
  metadata?: Record<string, unknown>;
}

export interface MicroActionDocument extends Omit<IMicroAction, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

const MicroActionSchema = new Schema<MicroActionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      enum: ['share', 'checkin', 'referral', 'profile', 'community', 'event', 'streak'] as MicroActionType[],
      required: true,
    },
    actionKey: {
      type: String,
      required: true,
    },
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    karmaBonus: {
      type: Number,
      required: true,
      min: 0,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: false,
    collection: 'micro_actions',
  },
);

// Compound unique index: one completion per type+key per day
// The actionKey already encodes the date slot, so this enforces uniqueness
MicroActionSchema.index({ userId: 1, actionType: 1, actionKey: 1 }, { unique: true });

// Index for efficient daily queries
MicroActionSchema.index({ userId: 1, completedAt: -1 });

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

interface MicroActionModel extends Model<MicroActionDocument> {
  completeDaily(
    userId: string,
    actionType: MicroActionType,
    actionKey: string,
    karmaBonus: number,
    metadata?: Record<string, unknown>,
  ): Promise<{ isNew: boolean; action: MicroActionDocument | null }>;
}

MicroActionSchema.statics.completeDaily = async function (
  userId: string,
  actionType: MicroActionType,
  actionKey: string,
  karmaBonus: number,
  metadata?: Record<string, unknown>,
): Promise<{ isNew: boolean; action: MicroActionDocument | null }> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error(`Invalid userId: ${userId}`);
  }

  try {
    const action = await this.findOneAndUpdate(
      {
        userId: new mongoose.Types.ObjectId(userId),
        actionType,
        actionKey,
      },
      {
        $setOnInsert: {
          userId: new mongoose.Types.ObjectId(userId),
          actionType,
          actionKey,
          completedAt: new Date(),
          karmaBonus,
          metadata: metadata ?? {},
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    return { isNew: action.createdAt === undefined || false, action };
  } catch (err: unknown) {
    // Handle duplicate key error (unique constraint violation) gracefully
    const mongooseErr = err as { code?: number };
    if (mongooseErr.code === 11000) {
      return { isNew: false, action: null };
    }
    throw err;
  }
};

export const MicroAction: MicroActionModel =
  mongoose.models.MicroAction
    ? (mongoose.models.MicroAction as unknown as MicroActionModel)
    : mongoose.model<MicroActionDocument, MicroActionModel>('MicroAction', MicroActionSchema);
