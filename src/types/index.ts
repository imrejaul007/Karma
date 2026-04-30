// @ts-nocheck
// @ts-ignore
// @deprecated — re-exported from @rez/shared-types. Migrate imports to @rez/shared-types directly.

import type {
  BatchStatus,
  CSRPoolStatus,
  KarmaScoreComponents,
  KarmaScoreBand,
  BandMetadata,
  TrustGrade,
  MomentumLabel,
  EarnRecordStatus,
} from '../shared-types';

// ─── Re-export all karma types from canonical source ───────────────────────────
export type {
  // Interfaces
  IKarmaProfile as KarmaProfile,
  IKarmaEvent as KarmaEvent,
  IQRCodeSet,
  IConversionBatch,
  ILevelInfo as LevelInfo,
  IKarmaStats,
  IEarnRecord as EarnRecord,
  IVerificationSignals as VerificationSignals,
  IBadge as Badge,
  ILevelHistoryEntry as LevelHistoryEntry,
  IConversionHistoryEntry as ConversionHistoryEntry,
  KarmaProfileDelta,
  // Enums / unions
  KarmaLevel as Level,
  KarmaConversionRate as ConversionRate,
  EarnRecordStatus,
  BatchStatus,
  CSRPoolStatus,
  KarmaVerificationStatus as VerificationStatus,
  EventDifficulty,
  EventCategory,
  KarmaEventStatus,
  // KarmaScore types (Phase 3: 300-900 model)
  KarmaScoreBand,
  TrustGrade,
  MomentumLabel,
  KarmaScoreComponents,
  BandMetadata,
  StabilitySnapshot,
  ScoreHistoryEntry,
  PerkType,
  PerkClaimStatus,
} from '../shared-types';

// ─── Service-specific types NOT in shared-types ────────────────────────────────

/**
 * Conversion batch: internal CSR pool reconciliation record.
 *
 * CV-23 NOTE: This is DIFFERENT from IConversionBatch in shared-types.
 * - IConversionBatch: admin-facing summary of a karma-to-coin conversion run
 * - Batch: internal CSR pool week reconciliation (weekStart/weekEnd/csrPoolId)
 * These serve different bounded contexts and must NOT be merged.
 */
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

/** CSR pool: corporate social responsibility budget allocation. */
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

/** Full karma score response from the Phase 3 scoring engine. */
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

/** Streak data for user engagement tracking. */
export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActivityAt: Date | null;
  streakActive: boolean;
}

/** Perk claim record for a user claiming a level perk. */
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
