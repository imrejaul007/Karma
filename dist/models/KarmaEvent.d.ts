import mongoose, { Document, Model } from 'mongoose';
import type { EventCategory, EventDifficulty, KarmaEventStatus } from '../types/index';
export interface KarmaEventDocument extends Omit<IKarmaEvent, '_id'>, Document {
    _id: mongoose.Types.ObjectId;
}
export interface IQRCodeSet {
    checkIn: string;
    checkOut: string;
}
export interface IKarmaEvent {
    _id: mongoose.Types.ObjectId;
    merchantEventId: mongoose.Types.ObjectId;
    ngoId: mongoose.Types.ObjectId;
    category: EventCategory;
    impactUnit: string;
    impactMultiplier: number;
    difficulty: EventDifficulty;
    expectedDurationHours: number;
    baseKarmaPerHour: number;
    maxKarmaPerEvent: number;
    qrCodes: IQRCodeSet;
    gpsRadius: number;
    maxVolunteers: number;
    confirmedVolunteers: number;
    status: KarmaEventStatus;
    createdAt: Date;
    updatedAt: Date;
}
export declare const KarmaEvent: Model<KarmaEventDocument>;
//# sourceMappingURL=KarmaEvent.d.ts.map