import mongoose from 'mongoose';
import type { KarmaProfileDocument } from '../models/KarmaProfile.js';
import type { LevelInfo } from '../types/index.js';
import { calculateLevel, getConversionRate } from '../engines/karmaEngine.js';
export { calculateLevel, getConversionRate };
/**
 * Retrieve a user's karma profile by userId.
 * Returns null if not found.
 */
export declare function getKarmaProfile(userId: string): Promise<KarmaProfileDocument | null>;
/**
 * Retrieve an existing karma profile, or create a new one if it doesn't exist.
 */
export declare function getOrCreateProfile(userId: string): Promise<KarmaProfileDocument>;
/**
 * Add karma to a user's profile.
 * Updates both activeKarma and lifetimeKarma.
 * Handles level-up: if the new activeKarma crosses a threshold,
 * the level is updated and a levelHistory entry is appended.
 *
 * BE-KAR-008 FIX: Enforces WEEKLY_COIN_CAP on karma accumulation.
 * If the user has already hit the weekly cap, the karma is rejected.
 */
export declare function addKarma(userId: string, karma: number, options?: {
    hours?: number;
    confidenceScore?: number;
    difficulty?: number;
    isCheckIn?: boolean;
    isApproved?: boolean;
}): Promise<void>;
/**
 * Record a karma event completion (called after verification is complete).
 * Increments eventsCompleted and calls addKarma.
 */
export declare function recordKarmaEarned(userId: string, karmaEarned: number, options?: {
    hours?: number;
    confidenceScore?: number;
    difficulty?: number;
}): Promise<void>;
/**
 * Apply daily decay to all karma profiles.
 * Returns counts of processed and decayed profiles.
 * Skips profiles with no active karma or very recent activity.
 */
/**
 * Apply decay to all active karma profiles.
 *
 * BE-KAR-009 FIX: Uses a distributed lock (Redis) to prevent concurrent decay
 * applications on the same user profile. Each user gets locked during decay check
 * to prevent double-decay.
 */
export declare function applyDecayToAll(): Promise<{
    processed: number;
    decayed: number;
    levelDrops: number;
}>;
/**
 * Get level information for a user including next level threshold.
 */
export declare function getLevelInfo(userId: string): Promise<LevelInfo>;
/**
 * Record a conversion event in the user's profile history.
 */
export declare function recordConversion(userId: string, karmaConverted: number, coinsEarned: number, rate: number, batchId: mongoose.Types.ObjectId): Promise<void>;
/**
 * Get the total karma converted (used) by a user within a given week.
 * If weekOf is not provided, defaults to the current week.
 */
export declare function getWeeklyKarmaUsed(userId: string, weekOf?: Date): Promise<number>;
/**
 * Get the conversion history for a user, most recent first.
 */
export declare function getKarmaHistory(userId: string, limit?: number): Promise<Array<{
    karmaConverted: number;
    coinsEarned: number;
    rate: number;
    batchId: string;
    convertedAt: Date;
}>>;
//# sourceMappingURL=karmaService.d.ts.map