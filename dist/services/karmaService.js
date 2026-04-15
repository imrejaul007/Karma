"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConversionRate = exports.calculateLevel = void 0;
exports.getKarmaProfile = getKarmaProfile;
exports.getOrCreateProfile = getOrCreateProfile;
exports.addKarma = addKarma;
exports.recordKarmaEarned = recordKarmaEarned;
exports.applyDecayToAll = applyDecayToAll;
exports.getLevelInfo = getLevelInfo;
exports.recordConversion = recordConversion;
exports.getWeeklyKarmaUsed = getWeeklyKarmaUsed;
exports.getKarmaHistory = getKarmaHistory;
/**
 * Karma Service — main business logic layer
 *
 * Provides high-level operations on karma profiles, including:
 * - Profile retrieval and creation
 * - Karma accumulation with decay-aware updates
 * - Level information
 * - Batch conversion tracking
 * - Weekly usage tracking
 */
const moment_1 = __importDefault(require("moment"));
const mongoose_1 = __importDefault(require("mongoose"));
const redis_js_1 = require("../config/redis.js");
const index_js_1 = require("../models/index.js");
const karmaEngine_js_1 = require("../engines/karmaEngine.js");
Object.defineProperty(exports, "calculateLevel", { enumerable: true, get: function () { return karmaEngine_js_1.calculateLevel; } });
Object.defineProperty(exports, "getConversionRate", { enumerable: true, get: function () { return karmaEngine_js_1.getConversionRate; } });
const logger_js_1 = require("../utils/logger.js");
// ---------------------------------------------------------------------------
// Profile Access
// ---------------------------------------------------------------------------
/**
 * Retrieve a user's karma profile by userId.
 * Returns null if not found.
 */
async function getKarmaProfile(userId) {
    const result = await index_js_1.KarmaProfile.findOne({ userId }).lean();
    if (!result)
        return null;
    // Attach minimal virtuals/defaults that lean() strips
    return result;
}
/**
 * Retrieve an existing karma profile, or create a new one if it doesn't exist.
 */
async function getOrCreateProfile(userId) {
    let profile = await index_js_1.KarmaProfile.findOne({ userId });
    if (!profile) {
        profile = await index_js_1.KarmaProfile.create({
            userId: new mongoose_1.default.Types.ObjectId(userId),
            lifetimeKarma: 0,
            activeKarma: 0,
            level: 'L1',
            eventsCompleted: 0,
            eventsJoined: 0,
            totalHours: 0,
            trustScore: 0,
            badges: [],
            lastActivityAt: null,
            levelHistory: [],
            conversionHistory: [],
            thisWeekKarmaEarned: 0,
            avgEventDifficulty: 0,
            avgConfidenceScore: 0,
            checkIns: 0,
            approvedCheckIns: 0,
            activityHistory: [],
        });
        logger_js_1.logger.info(`Created karma profile for user ${userId}`);
    }
    return profile;
}
// ---------------------------------------------------------------------------
// Karma Accumulation
// ---------------------------------------------------------------------------
/**
 * Add karma to a user's profile.
 * Updates both activeKarma and lifetimeKarma.
 * Handles level-up: if the new activeKarma crosses a threshold,
 * the level is updated and a levelHistory entry is appended.
 *
 * BE-KAR-008 FIX: Enforces WEEKLY_COIN_CAP on karma accumulation.
 * If the user has already hit the weekly cap, the karma is rejected.
 */
async function addKarma(userId, karma, options) {
    const profile = await getOrCreateProfile(userId);
    const oldLevel = profile.level;
    const oldActiveKarma = profile.activeKarma;
    // BE-KAR-003 & BE-KAR-008 FIX: Check weekly karma cap before accepting karma
    const WEEKLY_COIN_CAP = 300; // Import this from karmaEngine or config
    const startOfWeek = (0, moment_1.default)().startOf('week').toDate();
    let weeklyKarmaEarned = profile.thisWeekKarmaEarned;
    // Reset if we've moved to a new week
    if (profile.weekOfLastKarmaEarned &&
        (0, moment_1.default)(profile.weekOfLastKarmaEarned).startOf('week').isBefore(startOfWeek)) {
        weeklyKarmaEarned = 0;
    }
    // BE-KAR-008 FIX: Enforce weekly cap
    if (weeklyKarmaEarned >= WEEKLY_COIN_CAP) {
        logger_js_1.logger.warn(`[Karma] User ${userId} has hit weekly cap (${WEEKLY_COIN_CAP}), rejecting ${karma} karma`, {
            userId,
            karmaRequested: karma,
            weeklyCapRemaining: WEEKLY_COIN_CAP - weeklyKarmaEarned,
        });
        throw new Error(`Weekly karma cap exceeded. Remaining this week: ${WEEKLY_COIN_CAP - weeklyKarmaEarned}`);
    }
    // Accumulate karma
    profile.lifetimeKarma += karma;
    profile.activeKarma += karma;
    profile.lastActivityAt = new Date();
    profile.totalHours += options?.hours ?? 0;
    // Update trust metrics
    if (options?.isCheckIn) {
        profile.checkIns += 1;
        if (options?.isApproved) {
            profile.approvedCheckIns += 1;
        }
    }
    // Update running averages for trust score
    const totalEvents = profile.eventsCompleted + 1;
    profile.avgEventDifficulty =
        ((profile.avgEventDifficulty * profile.eventsCompleted) +
            (options?.difficulty ?? 0)) /
            totalEvents;
    profile.avgConfidenceScore =
        ((profile.avgConfidenceScore * profile.eventsCompleted) +
            (options?.confidenceScore ?? 0)) /
            totalEvents;
    // Recalculate level
    const newLevel = (0, karmaEngine_js_1.calculateLevel)(profile.activeKarma);
    if (newLevel !== oldLevel) {
        const previousEntry = profile.levelHistory[profile.levelHistory.length - 1];
        if (previousEntry && !previousEntry.droppedAt) {
            previousEntry.droppedAt = new Date();
        }
        profile.level = newLevel;
        const entry = {
            level: newLevel,
            earnedAt: new Date(),
        };
        profile.levelHistory.push(entry);
        logger_js_1.logger.info(`User ${userId} leveled ${newLevel === oldLevel ? 'maintained' : 'upgraded'} from ${oldLevel} to ${newLevel} (${oldActiveKarma} → ${profile.activeKarma} karma)`);
    }
    // Track weekly karma earned for cap enforcement
    const startOfWeek = (0, moment_1.default)().startOf('week').toDate();
    if (!profile.weekOfLastKarmaEarned ||
        (0, moment_1.default)(profile.weekOfLastKarmaEarned).startOf('week').isBefore(startOfWeek)) {
        profile.thisWeekKarmaEarned = karma;
        profile.weekOfLastKarmaEarned = new Date();
    }
    else {
        profile.thisWeekKarmaEarned += karma;
    }
    // Activity history (keep last 90 days)
    profile.activityHistory.push(new Date());
    if (profile.activityHistory.length > 90) {
        profile.activityHistory = profile.activityHistory.slice(-90);
    }
    await profile.save();
}
/**
 * Record a karma event completion (called after verification is complete).
 * Increments eventsCompleted and calls addKarma.
 */
async function recordKarmaEarned(userId, karmaEarned, options) {
    const profile = await getOrCreateProfile(userId);
    profile.eventsCompleted += 1;
    await profile.save();
    await addKarma(userId, karmaEarned, {
        ...options,
        isCheckIn: true,
        isApproved: true,
    });
}
// ---------------------------------------------------------------------------
// Daily Decay
// ---------------------------------------------------------------------------
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
async function applyDecayToAll() {
    const profiles = await index_js_1.KarmaProfile.find({ activeKarma: { $gt: 0 } }).lean();
    let decayedCount = 0;
    let levelDrops = 0;
    for (const raw of profiles) {
        const userId = raw.userId.toString();
        const lockKey = `decay-lock:${userId}`;
        const lockToken = `${Date.now()}-${Math.random()}`;
        // BE-KAR-009 FIX: Acquire distributed lock (10s TTL)
        const lockAcquired = await redis_js_1.redisClient.set(lockKey, lockToken, 'NX', 'EX', 10);
        if (!lockAcquired) {
            // Another process is decaying this user, skip
            logger_js_1.logger.debug(`Decay lock contention on user ${userId}, skipping`);
            continue;
        }
        try {
            const profile = await index_js_1.KarmaProfile.findById(raw._id);
            if (!profile)
                continue;
            // Cast the document to a plain object compatible with applyDailyDecay
            const plainProfile = profile;
            const delta = (0, karmaEngine_js_1.applyDailyDecay)(plainProfile, profile.userTimezone);
            if (delta.activeKarmaChange === 0)
                continue;
            decayedCount += 1;
            const newActiveKarma = Math.max(0, profile.activeKarma + delta.activeKarmaChange);
            profile.activeKarma = newActiveKarma;
            // BE-KAR-001 FIX: Persist lastDecayAppliedAt so decay is not reapplied today
            if (delta.lastDecayAppliedAt) {
                profile.lastDecayAppliedAt = delta.lastDecayAppliedAt;
            }
            if (delta.levelChange && delta.newLevel) {
                levelDrops += 1;
                const lastEntry = profile.levelHistory[profile.levelHistory.length - 1];
                if (lastEntry && !lastEntry.droppedAt) {
                    lastEntry.droppedAt = new Date();
                }
                profile.level = delta.newLevel;
                const entry = {
                    level: delta.newLevel,
                    earnedAt: new Date(),
                    reason: 'decay', // BE-KAR-007 FIX: Record decay as reason
                };
                profile.levelHistory.push(entry);
                logger_js_1.logger.info(`User ${profile.userId.toString()} level dropped from ${delta.oldLevel} to ${delta.newLevel} due to decay`);
            }
            await profile.save();
        }
        finally {
            // BE-KAR-009 FIX: Always release the lock
            const lockStillHeld = await redis_js_1.redisClient.get(lockKey);
            if (lockStillHeld === lockToken) {
                await redis_js_1.redisClient.del(lockKey);
            }
        }
    }
    logger_js_1.logger.info(`Decay job complete: processed=${profiles.length}, decayed=${decayedCount}, levelDrops=${levelDrops}`);
    return {
        processed: profiles.length,
        decayed: decayedCount,
        levelDrops,
    };
}
// ---------------------------------------------------------------------------
// Level Info
// ---------------------------------------------------------------------------
/**
 * Get level information for a user including next level threshold.
 */
async function getLevelInfo(userId) {
    const profile = await getOrCreateProfile(userId);
    const level = profile.level;
    return {
        level,
        conversionRate: (0, karmaEngine_js_1.getConversionRate)(level),
        nextLevelAt: (0, karmaEngine_js_1.nextLevelThreshold)(level),
        activeKarma: profile.activeKarma,
    };
}
// ---------------------------------------------------------------------------
// Conversion History
// ---------------------------------------------------------------------------
/**
 * Record a conversion event in the user's profile history.
 */
async function recordConversion(userId, karmaConverted, coinsEarned, rate, batchId) {
    const profile = await index_js_1.KarmaProfile.findOne({ userId });
    if (!profile) {
        logger_js_1.logger.warn(`Cannot record conversion: profile not found for user ${userId}`);
        return;
    }
    const entry = {
        karmaConverted,
        coinsEarned,
        rate,
        batchId,
        convertedAt: new Date(),
    };
    profile.conversionHistory.push(entry);
    // Keep last 100 conversion entries
    if (profile.conversionHistory.length > 100) {
        profile.conversionHistory = profile.conversionHistory.slice(-100);
    }
    await profile.save();
    logger_js_1.logger.info(`Recorded conversion for ${userId}: ${karmaConverted} karma → ${coinsEarned} coins @ ${rate * 100}% (batch ${batchId})`);
}
// ---------------------------------------------------------------------------
// Weekly Karma Tracking
// ---------------------------------------------------------------------------
/**
 * Get the total karma converted (used) by a user within a given week.
 * If weekOf is not provided, defaults to the current week.
 */
async function getWeeklyKarmaUsed(userId, weekOf) {
    const profile = await getOrCreateProfile(userId);
    const targetWeek = weekOf
        ? (0, moment_1.default)(weekOf).startOf('week')
        : (0, moment_1.default)().startOf('week');
    if (profile.weekOfLastKarmaEarned &&
        (0, moment_1.default)(profile.weekOfLastKarmaEarned).startOf('week').isSame(targetWeek)) {
        return profile.thisWeekKarmaEarned;
    }
    return 0;
}
// ---------------------------------------------------------------------------
// Karma History
// ---------------------------------------------------------------------------
/**
 * Get the conversion history for a user, most recent first.
 */
async function getKarmaHistory(userId, limit = 20) {
    const profile = await getOrCreateProfile(userId);
    return profile.conversionHistory
        .slice()
        .reverse()
        .slice(0, limit)
        .map((entry) => ({
        karmaConverted: entry.karmaConverted,
        coinsEarned: entry.coinsEarned,
        rate: entry.rate,
        batchId: entry.batchId.toString(),
        convertedAt: entry.convertedAt,
    }));
}
//# sourceMappingURL=karmaService.js.map