import mongoose, { Document, Model } from 'mongoose';
import type { BatchStatus } from '../types/index';
export interface BatchDocument extends Omit<IBatch, '_id'>, Document {
    _id: mongoose.Types.ObjectId;
}
export interface IAnomalyFlag {
    type: 'too_many_from_one_ngo' | 'suspicious_timestamps' | 'pool_shortage';
    count: number;
    resolved: boolean;
}
export interface IBatch {
    _id: mongoose.Types.ObjectId;
    weekStart: Date;
    weekEnd: Date;
    csrPoolId: mongoose.Types.ObjectId;
    totalEarnRecords: number;
    totalKarma: number;
    totalRezCoinsEstimated: number;
    totalRezCoinsExecuted: number;
    status: BatchStatus;
    anomalyFlags: IAnomalyFlag[];
    executedAt?: Date;
    executedBy?: mongoose.Types.ObjectId;
    pauseReason?: string;
    pausedAt?: Date;
    createdAt: Date;
}
export declare const Batch: Model<BatchDocument>;
//# sourceMappingURL=Batch.d.ts.map