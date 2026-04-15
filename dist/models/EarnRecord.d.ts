import mongoose, { Document, Model } from 'mongoose';
import type { EarnRecordStatus, Level, VerificationSignals } from '../types/index';
export interface EarnRecordDocument extends Omit<IEarnRecord, '_id'>, Document {
    _id: mongoose.Types.ObjectId;
}
export interface IEarnRecord {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    eventId: mongoose.Types.ObjectId;
    bookingId: mongoose.Types.ObjectId;
    karmaEarned: number;
    activeLevelAtApproval: Level;
    conversionRateSnapshot: number;
    csrPoolId: mongoose.Types.ObjectId;
    verificationSignals: VerificationSignals;
    confidenceScore: number;
    status: EarnRecordStatus;
    createdAt: Date;
    approvedAt?: Date;
    convertedAt?: Date;
    convertedBy?: mongoose.Types.ObjectId;
    batchId?: mongoose.Types.ObjectId;
    rezCoinsEarned?: number;
    idempotencyKey: string;
}
export declare const EarnRecord: Model<EarnRecordDocument>;
//# sourceMappingURL=EarnRecord.d.ts.map