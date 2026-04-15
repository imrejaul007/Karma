import type { Level, ConversionRate, KarmaEvent, KarmaProfile, KarmaProfileDelta } from '../types/index.js';
export declare const LEVEL_THRESHOLDS: Readonly<Record<Level, number>>;
export declare const DECAY_SCHEDULE: Readonly<Record<number, number>>;
export declare const WEEKLY_COIN_CAP = 300;
/**
 * Determine the user's current level based on active karma.
 * L1: 0–499, L2: 500–1999, L3: 2000–4999, L4: 5000+
 */
export declare function calculateLevel(activeKarma: number): Level;
/**
 * Return the conversion rate for a given level.
 *
 * Semantic: 1 karma converts to getConversionRate(level) coins.
 * E.g., L4 users get 1 coin per karma, L1 users get 0.25 coins per karma.
 *
 * BE-KAR-005 FIX: Added documentation and validation.
 */
export declare function getConversionRate(level: string): ConversionRate;
/**
 * BE-KAR-021 FIX: Convert karma to coins using the level-specific rate.
 * This is the single authoritative place for karma-to-coin conversion logic.
 *
 * @param karma Amount of karma to convert
 * @param level User's current level
 * @returns Coins earned from conversion
 */
export declare function convertKarmaToCoins(karma: number, level: Level): number;
/**
 * Calculate karma earned from a verified event completion.
 * Applies base rate, impact multiplier, difficulty multiplier, and per-event cap.
 *
 * BE-KAR-014 & BE-KAR-015 FIXES:
 * - Validates baseKarmaPerHour > 0
 * - Validates maxKarmaPerEvent > 0
 */
export declare function calculateKarmaEarned(event: KarmaEvent, hours: number): number;
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
export declare function applyDailyDecay(profile: KarmaProfile, userTimezone?: string): KarmaProfileDelta;
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
export declare function calculateTrustScore(profile: KarmaProfile): number;
/**
 * Convert karma earned to ReZ coins at the given rate.
 * Uses floor to avoid fractional coins.
 */
export declare function calculateConversion(karmaEarned: number, rate: ConversionRate): number;
/**
 * Apply weekly per-user cap (300 coins) to a coin amount.
 * Returns the lesser of the coins earned or remaining weekly capacity.
 */
export declare function applyCaps(coins: number, weeklyEarned: number): number;
/**
 * Return the active karma threshold for the next level, or null if at L4.
 */
export declare function nextLevelThreshold(currentLevel: Level): number | null;
/**
 * Get karma remaining until the next level.
 */
export declare function karmaToNextLevel(activeKarma: number): number;
//# sourceMappingURL=karmaEngine.d.ts.map