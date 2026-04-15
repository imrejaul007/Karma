import mongoose, { Document, Model } from 'mongoose';
import type { CSRPoolStatus } from '../types/index';
export interface CSRPoolDocument extends Omit<ICSRPool, '_id'>, Document {
    _id: mongoose.Types.ObjectId;
}
export interface ICSRPool {
    _id: mongoose.Types.ObjectId;
    name: string;
    campaignId: mongoose.Types.ObjectId;
    corporateId: mongoose.Types.ObjectId;
    totalBudget: number;
    remainingBudget: number;
    coinPool: number;
    coinPoolRemaining: number;
    issuedCoins: number;
    status: CSRPoolStatus;
    startDate: Date;
    endDate: Date;
    events: mongoose.Types.ObjectId[];
    createdAt: Date;
}
export declare const CSRPool: Model<CSRPoolDocument>;
//# sourceMappingURL=CSRPool.d.ts.map