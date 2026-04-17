/**
 * Karma Engine — core calculation logic for Karma by ReZ
 *
 * Implements karma calculation, level determination, decay,
 * trust scoring, and coin conversion.
 */
import moment from 'moment';
import type {
  Level,
  ConversionRate,
  KarmaEvent,
  KarmaProfile,
  KarmaProfileDelta,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEVEL_THRESHOLDS: Readonly<Record<Level, number>> = {
  L1: 0,
  L2: 500,
  L3: 2000,
  L4: 5000,
} as const;

// BE-KAR-002 FIX: Validate thresholds are in ascending order at initialization
function validateLevelThresholds(): void {
  const levels: Level[] = ['L1', 'L2', 'L3', 'L4'];
  for (let i = 1; i < levels.length; i++) {
    if (LEVEL_THRESHOLDS[levels[i]] <= LEVEL_THRESHOLDS[levels[i - 1]]) {
      throw new Error(
        `Level thresholds not in ascending order: ${levels[i - 1]}=${LEVEL_THRESHOLDS[levels[i - 1]]} >= ${levels[i]}=${LEVEL_THRESHOLDS[levels[i]]}`
      );
    }
  }
}

export const DECAY_SCHEDULE: Readonly<Record<number, number>> = {
  30: 0.20,
  45: 0.40,
  60: 0.70,
} as const;

// BE-KAR-016 FIX: Validate decay schedule is in ascending order with increasing rates
function validateDecaySchedule(): void {
  const days = Object.keys(DECAY_SCHEDULE)
    .map(Number)
    .sort((a, b) => a - b);

  for (let i = 1; i < days.length; i++) {
    if (days[i] <= days[i - 1]) {
      throw new Error(`Decay schedule days not in ascending order: ${days[i - 1]}, ${days[i]}`);
    }
    if (DECAY_SCHEDULE[days[i]] <= DECAY_SCHEDULE[days[i - 1]]) {
      throw new Error(
        `Decay rates not increasing monotonically: day ${days[i - 1]} has rate ${DECAY_SCHEDULE[days[i - 1]]}, ` +
        `day ${days[i]} has rate ${DECAY_SCHEDULE[days[i]]}`
      );
    }
  }
}

// Run validations at module load time
validateLevelThresholds();
validateDecaySchedule();

export const WEEKLY_COIN_CAP = 300;

const DIFFICULTY_MULTIPLIERS: Readonly<Record<string, number>> = {
  easy: 1.0,
  medium: 1.5,
  hard: 2.0,
};

// ---------------------------------------------------------------------------
// Level Determination
// ---------------------------------------------------------------------------

/**
 * Determine the user's current level based on active karma.
 * L1: 0–499, L2: 500–1999, L3: 2000–4999, L4: 5000+
 */
export function calculateLevel(activeKarma: number): Level {
  if (activeKarma >= LEVEL_THRESHOLDS.L4) return 'L4';
  if (activeKarma >= LEVEL_THRESHOLDS.L3) return 'L3';
  if (activeKarma >= LEVEL_THRESHOLDS.L2) return 'L2';
  return 'L1';
}

/**
 * Return the conversion rate for a given level.
 *
 * Semantic: 1 karma converts to getConversionRate(level) coins.
 * E.g., L4 users get 1 coin per karma, L1 users get 0.25 coins per karma.
 *
 * BE-KAR-005 FIX: Added documentation and validation.
 */
export function getConversionRate(level: string): ConversionRate {
  const rate = (() => {
    switch (level) {
      case 'L4':
        return 1.0;
      case 'L3':
        return 0.75;
      case 'L2':
        return 0.5;
      case 'L1':
      default:
        return 0.25;
    }
  })();

  // Validate rate is within reasonable bounds
  if (typeof rate !== 'number' || rate < 0 || rate > 2) {
    throw new Error(
      `Invalid conversion rate ${rate} for level ${level}. Must be between 0 and 2.`
    );
  }

  return rate;
}

/**
 * BE-KAR-021 FIX: Convert karma to coins using the level-specific rate.
 * This is the single authoritative place for karma-to-coin conversion logic.
 *
 * @param karma Amount of karma to convert
 * @param level User's current level
 * @returns Coins earned from conversion
 */
export function convertKarmaToCoins(karma: number, level: Level): number {
  if (typeof karma !== 'number' || !Number.isFinite(karma) || karma < 0) {
    throw new Error(`Invalid karma value: ${karma} (must be a finite non-negative number)`);
  }

  const rate = getConversionRate(level);
  const coins = Math.floor(karma * rate);

  return coins;
}

// ---------------------------------------------------------------------------
// Karma Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate karma earned from a verified event completion.
 * Applies base rate, impact multiplier, difficulty multiplier, and per-event cap.
 *
 * BE-KAR-014 & BE-KAR-015 FIXES:
 * - Validates baseKarmaPerHour > 0
 * - Validates maxKarmaPerEvent > 0
 */
export function calculateKarmaEarned(event: KarmaEvent, hours: number): number {
  if (event.baseKarmaPerHour <= 0) {
    throw new Error(
      `Invalid baseKarmaPerHour: ${event.baseKarmaPerHour} (must be positive)`
    );
  }
  if (event.maxKarmaPerEvent <= 0) {
    throw new Error(
      `Invalid maxKarmaPerEvent: ${event.maxKarmaPerEvent} (must be positive)`
    );
  }
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
    throw new Error(
      `Invalid hours: ${hours} (must be a finite non-negative number)`
    );
  }

  let karma = event.baseKarmaPerHour * hours;
  karma *= event.impactMultiplier;

  // BE-KAR-013 FIX: Validate difficulty is known, error instead of silently using 1.0
  if (!(event.difficulty in DIFFICULTY_MULTIPLIERS)) {
    throw new Error(
      `Unknown difficulty level: ${event.difficulty}. Valid values: ${Object.keys(DIFFICULTY_MULTIPLIERS).join(', ')}`
    );
  }
  const difficultyMult = DIFFICULTY_MULTIPLIERS[event.difficulty];
  karma *= difficultyMult;

  return Math.min(Math.floor(karma), event.maxKarmaPerEvent);
}

// ---------------------------------------------------------------------------
// Decay System
// ---------------------------------------------------------------------------

/**
 * Calculate the number of whole days between two dates.
 *
 * BE-KAR-006 FIX: Use user's timezone instead of server's local timezone.
 * If userTimezone is not provided, defaults to UTC.
 */
function daysBetween(from: Date | null, to: Date, userTimezone?: string): number {
  if (!from) return 999; // treat null as very old

  // Apply timezone if provided, otherwise use UTC
  // G-KS-M32 FIX: Use UTC throughout to avoid moment-timezone dependency.
  // Server-side decay calculations are timezone-agnostic — using UTC is consistent.
  const toMoment = moment.utc(to);
  const fromMoment = moment.utc(from);

  return Math.max(0, toMoment.startOf('day').diff(fromMoment.startOf('day'), 'days'));
}

/**
 * Apply daily decay to a karma profile based on days since last activity.
 * Returns the delta (changes) without mutating the profile.
 *
 * Decay schedule:
 *   30+ days inactive → 20% decay
 *   45+ days inactive → 40% decay
 *   60+ days inactive → 70% decay (reset to near zero)
 *   <30 days inactive → no decay
 *
 * BE-KAR-001 FIX: Check lastDecayAppliedAt to prevent double-decay on the same day.
 * BE-KAR-009 FIX: This function should be wrapped with a distributed lock by the caller.
 */
export function applyDailyDecay(profile: KarmaProfile, userTimezone?: string): KarmaProfileDelta {
  // BE-KAR-001 FIX: Check if decay was already applied today
  if (profile.lastDecayAppliedAt) {
    const daysSinceLastDecay = daysBetween(
      profile.lastDecayAppliedAt,
      new Date(),
      userTimezone
    );
    if (daysSinceLastDecay === 0) {
      // Decay already applied today, skip
      return { activeKarmaChange: 0, levelChange: false };
    }
  }

  const daysSinceLastActivity = daysBetween(
    profile.lastActivityAt,
    new Date(),
    userTimezone
  );

  let decayRate = 0;
  if (daysSinceLastActivity >= 60) {
    decayRate = DECAY_SCHEDULE[60];
  } else if (daysSinceLastActivity >= 45) {
    decayRate = DECAY_SCHEDULE[45];
  } else if (daysSinceLastActivity >= 30) {
    decayRate = DECAY_SCHEDULE[30];
  }

  if (decayRate === 0) {
    return { activeKarmaChange: 0, levelChange: false };
  }

  const oldLevel = profile.level;
  // FIX: Clamp to 0 to ensure karma never goes negative and level calculation is correct.
  // Previously, the engine returned unclamped values while the service layer clamped separately,
  // which could cause the delta's newLevel to disagree with the actual stored karma.
  const newActiveKarma = Math.max(0, Math.floor(profile.activeKarma * (1 - decayRate)));
  const newLevel = calculateLevel(newActiveKarma);

  return {
    activeKarmaChange: newActiveKarma - profile.activeKarma,
    levelChange: newLevel !== oldLevel,
    oldLevel: oldLevel as Level,
    newLevel,
    // BE-KAR-001 FIX: Return new lastDecayAppliedAt so caller can persist it
    lastDecayAppliedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Trust Score
// ---------------------------------------------------------------------------

/**
 * Calculate a trust score (0–100) from profile activity metrics.
 *
 * Weights:
 *   Completion rate   30%  — eventsCompleted / eventsJoined
 *   Approval rate      25%  — approvedCheckIns / checkIns
 *   Consistency        20%  — regularity of participation (standard deviation)
 *   Impact quality     15%  — avgEventDifficulty (0–1 normalized)
 *   Verification       10%  — avgConfidenceScore (0–1)
 *
 * BE-KAR-004 FIX: Clamp result to [0, 100] and handle division by zero.
 */
export function calculateTrustScore(profile: KarmaProfile): number {
  const completionRate =
    profile.eventsJoined > 0
      ? profile.eventsCompleted / profile.eventsJoined
      : 0;

  const approvalRate =
    profile.checkIns > 0
      ? profile.approvedCheckIns / profile.checkIns
      : 0;

  const consistency = calculateConsistencyScore(profile.activityHistory);
  const impactQuality = profile.avgEventDifficulty ?? 0;
  const verificationStrength = profile.avgConfidenceScore ?? 0;

  const score = Math.round(
    completionRate * 30 +
    approvalRate * 25 +
    consistency * 20 +
    impactQuality * 15 +
    verificationStrength * 10
  );

  // BE-KAR-004 FIX: Clamp to valid trust score range [0, 100]
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate consistency score (0–1) from activity history.
 * Based on the standard deviation of days between consecutive activities.
 * More regular participation → higher score.
 */
function calculateConsistencyScore(activityHistory: Date[]): number {
  if (activityHistory.length < 2) {
    // No history or single event = neutral consistency
    return activityHistory.length === 1 ? 0.5 : 0;
  }

  // FIX: Use absolute timestamps (epoch days) instead of dayOfYear() to avoid
  // year-boundary wrapping bugs. dayOfYear() resets to 1 on Jan 1, producing
  // negative gaps when activity spans Dec→Jan.
  const sortedEpochDays = activityHistory
    .map((d) => Math.floor(moment(d).valueOf() / 86_400_000))
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < sortedEpochDays.length; i++) {
    gaps.push(sortedEpochDays[i] - sortedEpochDays[i - 1]);
  }

  if (gaps.length === 0) return 1;
  const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (meanGap === 0) return 1;

  const variance =
    gaps.reduce((s, g) => s + Math.pow(g - meanGap, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  // Normalize: low stdDev = high consistency
  // stdDev of 0 → 1, stdDev of 30+ days → 0
  const score = Math.max(0, 1 - stdDev / 30);
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert karma earned to ReZ coins at the given rate.
 * Uses floor to avoid fractional coins.
 */
export function calculateConversion(karmaEarned: number, rate: ConversionRate): number {
  return Math.floor(karmaEarned * rate);
}

/**
 * Apply weekly per-user cap (300 coins) to a coin amount.
 * Returns the lesser of the coins earned or remaining weekly capacity.
 */
export function applyCaps(coins: number, weeklyEarned: number): number {
  const weeklyRemaining = Math.max(0, WEEKLY_COIN_CAP - weeklyEarned);
  return Math.min(coins, weeklyRemaining);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Return the active karma threshold for the next level, or null if at L4.
 */
export function nextLevelThreshold(currentLevel: Level): number | null {
  switch (currentLevel) {
    case 'L1':
      return LEVEL_THRESHOLDS.L2;
    case 'L2':
      return LEVEL_THRESHOLDS.L3;
    case 'L3':
      return LEVEL_THRESHOLDS.L4;
    case 'L4':
      return null;
  }
}

/**
 * Get karma remaining until the next level.
 */
export function karmaToNextLevel(activeKarma: number): number {
  const level = calculateLevel(activeKarma);
  const next = nextLevelThreshold(level);
  if (next === null) return 0;
  return Math.max(0, next - activeKarma);
}
