import mongoose, { Document, Model } from 'mongoose';
import type { Level } from '../types/index';
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
}
export declare const KarmaProfile: Model<KarmaProfileDocument>;
//# sourceMappingURL=KarmaProfile.d.ts.map