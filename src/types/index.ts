// Canonical source: @rez/shared-types/enums - keep in sync
// These types are defined locally because @rez/shared-types is not an npm dependency.
// Any changes here MUST be mirrored in packages/shared-types/src/enums/.

export type Level = 'L1' | 'L2' | 'L3' | 'L4';

export type ConversionRate = 0.25 | 0.5 | 0.75 | 1.0;

export type EarnRecordStatus =
  | 'APPROVED_PENDING_CONVERSION'
  | 'CONVERTED'
  | 'REJECTED'
  | 'ROLLED_BACK'
  | 'CONVERSION_FAILED';

export type BatchStatus = 'DRAFT' | 'READY' | 'EXECUTED' | 'PARTIAL' | 'PAUSED';

export type VerificationStatus = 'pending' | 'partial' | 'verified' | 'rejected';

export type EventDifficulty = 'easy' | 'medium' | 'hard';

export type EventCategory =
  | 'environment'
  | 'food'
  | 'health'
  | 'education'
  | 'community';

export type KarmaEventStatus =
  | 'draft'
  | 'published'
  | 'ongoing'
  | 'completed'
  | 'cancelled';

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
  // G-KS-M1 FIX: Add reason field to track why level changed.
  reason?: string;
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
  // G-KS-A1 FIX: Track when decay was last applied to prevent double-decay.
  lastDecayAppliedAt?: Date;
  // G-KS-M32 FIX: Store user's timezone for decay calculations.
  userTimezone?: string;
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
    type:
      | 'too_many_from_one_ngo'
      | 'suspicious_timestamps'
      | 'pool_shortage';
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
  // BE-KAR-001 FIX: Track when decay was applied to prevent double-decay
  lastDecayAppliedAt?: Date;
}

export interface LevelInfo {
  level: Level;
  conversionRate: ConversionRate;
  nextLevelAt: number | null;
  activeKarma: number;
}

// ─── KarmaScore types ─────────────────────────────────────────────────────────

export interface KarmaScoreComponents {
  base: number;
  impact: number;
  relativeRank: number;
  trust: number;
  momentum: number;
}

export interface KarmaScoreResponse {
  userId: string;
  total: number;
  display: number;
  raw: number;
  components: KarmaScoreComponents;
  band: KarmaScoreBand;
  bandMeta: BandMetadata;
  percentile: number;
  trustGrade: TrustGrade;
  momentumLabel: MomentumLabel;
  stability: {
    raw: number;
    display: number;
    lastRawAt: number;
  } | null;
}

export interface ScoreHistoryEntry {
  date: Date;
  rawScore: number;
  displayScore: number;
  band: string;
  percentile: number;
  components: KarmaScoreComponents;
  activeKarma: number;
  lifetimeKarma: number;
}

export type KarmaScoreBand = 'starter' | 'active' | 'performer' | 'leader' | 'elite' | 'pinnacle';
export type TrustGrade = 'D' | 'C' | 'B' | 'A' | 'S';
export type MomentumLabel = 'cold' | 'slow' | 'steady' | 'hot' | 'blazing';

export interface BandMetadata {
  label: string;
  color: string;
  bgColor: string;
  minScore: number;
  maxScore: number;
  perks: string[];
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActivityAt: Date | null;
  streakActive: boolean;
}

export interface PerkClaim {
  id: string;
  perkId: string;
  perkName: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  claimedAt: Date;
  expiresAt: Date;
  redemptionCode?: string;
  merchantId?: string;
}
