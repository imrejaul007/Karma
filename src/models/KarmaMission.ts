// @ts-ignore
/**
 * KarmaMission Model — user mission tracking
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUserMission extends Document {
  userId: mongoose.Types.ObjectId;
  missionId: string;
  status: 'active' | 'completed' | 'failed';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
}

const UserMissionSchema = new Schema<IUserMission>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    missionId: { type: String, required: true, index: true },
    status: { type: String, enum: ['active', 'completed', 'failed'], default: 'active' },
    progress: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: false, collection: 'user_missions' },
);

UserMissionSchema.index({ userId: 1, missionId: 1 }, { unique: true });

export const UserMission: Model<IUserMission> =
  mongoose.models.UserMission ||
  mongoose.model<IUserMission>('UserMission', UserMissionSchema);
