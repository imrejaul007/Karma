export type Level = 'L1' | 'L2' | 'L3' | 'L4';
export type ConversionRate = 0.25 | 0.5 | 0.75 | 1.0;
export type EarnRecordStatus = 'APPROVED_PENDING_CONVERSION' | 'CONVERTED' | 'REJECTED' | 'ROLLED_BACK';
export type BatchStatus = 'DRAFT' | 'READY' | 'EXECUTED' | 'PARTIAL' | 'PAUSED';
export type VerificationStatus = 'pending' | 'partial' | 'verified' | 'rejected';
export type EventDifficulty = 'easy' | 'medium' | 'hard';
export type EventCategory = 'environment' | 'food' | 'health' | 'education' | 'community';
export type KarmaEventStatus = 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';
export type CSRPoolStatus = 'active' | 'depleted' | 'expired';
export interface Badge {
    id: string;
    name: string;
    earnedAt: Date;
}
export interface LevelHistoryEntry {
    level: string;
    earnedAt: Date;
    droppedAt?: Date;
}
export interface ConversionHistoryEntry {
    karmaConverted: number;
    coinsEarned: number;
    rate: number;
    batchId: string;
    convertedAt: Date;
}
export interface VerificationSignals {
    qr_in: boolean;
    qr_out: boolean;
    gps_match: number;
    ngo_approved: boolean;
    photo_proof: boolean;
}
export interface KarmaProfile {
    _id: string;
    userId: string;
    lifetimeKarma: number;
    activeKarma: number;
    level: Level;
    eventsCompleted: number;
    eventsJoined: number;
    totalHours: number;
    trustScore: number;
    badges: Badge[];
    lastActivityAt: Date;
    levelHistory: LevelHistoryEntry[];
    conversionHistory: ConversionHistoryEntry[];
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
export interface KarmaEvent {
    _id: string;
    merchantEventId: string;
    ngoId: string;
    category: EventCategory;
    impactUnit: string;
    impactMultiplier: number;
    difficulty: EventDifficulty;
    expectedDurationHours: number;
    baseKarmaPerHour: number;
    maxKarmaPerEvent: number;
    qrCodes: {
        checkIn: string;
        checkOut: string;
    };
    gpsRadius: number;
    maxVolunteers: number;
    confirmedVolunteers: number;
    status: KarmaEventStatus;
}
export interface EarnRecord {
    _id: string;
    userId: string;
    eventId: string;
    bookingId: string;
    karmaEarned: number;
    activeLevelAtApproval: Level;
    conversionRateSnapshot: number;
    csrPoolId: string;
    verificationSignals: VerificationSignals;
    confidenceScore: number;
    status: EarnRecordStatus;
    createdAt: Date;
    approvedAt?: Date;
    convertedAt?: Date;
    convertedBy?: string;
    batchId?: string;
    rezCoinsEarned?: number;
    idempotencyKey: string;
}
export interface Batch {
    _id: string;
    weekStart: Date;
    weekEnd: Date;
    csrPoolId: string;
    totalEarnRecords: number;
    totalKarma: number;
    totalRezCoinsEstimated: number;
    totalRezCoinsExecuted: number;
    status: BatchStatus;
    anomalyFlags: Array<{
        type: 'too_many_from_one_ngo' | 'suspicious_timestamps' | 'pool_shortage';
        count: number;
        resolved: boolean;
    }>;
    executedAt?: Date;
    executedBy?: string;
    createdAt: Date;
}
export interface CSRPool {
    _id: string;
    name: string;
    campaignId: string;
    corporateId: string;
    totalBudget: number;
    remainingBudget: number;
    coinPool: number;
    coinPoolRemaining: number;
    issuedCoins: number;
    status: CSRPoolStatus;
    startDate: Date;
    endDate: Date;
    events: string[];
}
export interface KarmaProfileDelta {
    activeKarmaChange: number;
    levelChange: boolean;
    oldLevel?: Level;
    newLevel?: Level;
    lastDecayAppliedAt?: Date;
}
export interface LevelInfo {
    level: Level;
    conversionRate: ConversionRate;
    nextLevelAt: number | null;
    activeKarma: number;
}
//# sourceMappingURL=index.d.ts.map