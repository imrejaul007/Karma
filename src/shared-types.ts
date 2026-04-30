/**
 * Local types replacement for @rez/shared-types
 * These types mirror the types from @rez/shared-types
 */

// Karma Types
export type KarmaLevel = 'L1' | 'L2' | 'L3' | 'L4';
export type KarmaConversionRate = number;
export type EarnRecordStatus = 'pending' | 'approved' | 'rejected';
export type KarmaEventStatus = 'active' | 'completed' | 'cancelled';
export type EventCategory = 'environment' | 'food' | 'health' | 'education' | 'community';
export type EventDifficulty = 'easy' | 'medium' | 'hard';

// Level Info
export interface ILevelInfo {
  label: string;
  perks: string[];
  color: string;
  minScore: number;
  maxScore: number;
}

// Verification Types
export interface IVerificationSignals {
  [key: string]: number | boolean | undefined;
}

// Karma Event
export interface IKarmaEvent {
  id: string;
  title: string;
  category: EventCategory;
  difficulty: EventDifficulty;
  karmaPoints: number;
  baseKarmaPerHour?: number;
  maxKarmaPerEvent?: number;
  impactMultiplier?: number;
}

// Karma Profile
export interface IKarmaProfile {
  id: string;
  karmaScore: number;
  level: KarmaLevel;
  totalEarned: number;
  totalSpent: number;
  streak: number;
  lastActiveAt: Date;
  lastActivityAt?: Date;
  lastDecayAppliedAt?: Date;
  activeKarma?: number;
  eventsJoined?: number;
  eventsCompleted?: number;
  checkIns?: number;
  approvedCheckIns?: number;
  activityHistory?: Date[];
  avgEventDifficulty?: number;
  avgConfidenceScore?: number;
  [key: string]: unknown;
}

// Karma Profile Delta
export interface KarmaProfileDelta {
  scoreChange?: number;
  newScore?: number;
  levelChange: boolean;
  newLevel?: KarmaLevel;
  activeKarmaChange?: number;
  oldLevel?: KarmaLevel;
  lastDecayAppliedAt?: Date;
  [key: string]: unknown;
}

// Batch Types
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'failed';

// CSR Pool Types
export type CSRPoolStatus = 'active' | 'inactive' | 'suspended';

// Additional types
export interface ScoreHistoryEntry {
  timestamp: Date;
  score: number;
  delta: number;
}

export interface IBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt?: Date;
}

export interface ILevelHistoryEntry {
  level: KarmaLevel;
  earnedAt: Date;
  droppedAt?: Date;
}

export interface IConversionHistoryEntry {
  amount: number;
  convertedAt: Date;
  transactionId: string;
}

export type PerkType = 'discount' | 'early_access' | 'badge' | 'cashback';

export type PerkClaimStatus = 'available' | 'claimed' | 'expired';

export type KarmaVerificationStatus = 'pending' | 'verified' | 'rejected';

export interface StabilitySnapshot {
  timestamp: Date;
  stabilityScore: number;
  volatilityIndex: number;
}

export interface IConversionBatch {
  id: string;
  profileId: string;
  status: string;
  createdAt: Date;
}

export interface IKarmaStats {
  totalEvents: number;
  completedEvents: number;
  averageScore: number;
  rank: number;
  totalParticipants: number;
}

export interface IEarnRecord {
  id: string;
  profileId: string;
  eventId: string;
  amount: number;
  status: EarnRecordStatus;
  verifiedAt?: Date;
  createdAt: Date;
}

export interface IQRCodeSet {
  in: string;
  out: string;
}

// Score types
export interface KarmaScoreComponents {
  base: number;
  recency: number;
  consistency: number;
  difficulty: number;
  total: number;
}

export type KarmaScoreBand = 'starter' | 'active' | 'performer' | 'leader' | 'elite' | 'pinnacle';

export interface BandMetadata {
  label: string;
  color: string;
  bgColor: string;
  minScore: number;
  maxScore: number;
  perks: string[];
}

export type TrustGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type MomentumLabel = 'cold' | 'slow' | 'steady' | 'hot' | 'blazing';
