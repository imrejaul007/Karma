"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Karma Routes — REST API endpoints
 *
 * Base path: /api/karma
 *
 * GET  /api/karma/user/:userId         — get full karma profile
 * GET  /api/karma/user/:userId/history — get conversion history
 * GET  /api/karma/user/:userId/level   — get level + conversion rate info
 * POST /api/karma/decay-all            — trigger decay for all profiles (admin)
 */
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const adminAuth_js_1 = require("../middleware/adminAuth.js");
const karmaService_js_1 = require("../services/karmaService.js");
const karmaEngine_js_1 = require("../engines/karmaEngine.js");
const logger_js_1 = require("../utils/logger.js");
const router = (0, express_1.Router)();
/**
 * GET /api/karma/user/:userId
 * Returns the full karma profile for a user.
 */
router.get('/user/:userId', auth_js_1.requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const profile = await (0, karmaService_js_1.getKarmaProfile)(userId);
        if (!profile) {
            res.status(404).json({ error: 'Karma profile not found for this user' });
            return;
        }
        const level = (profile.level ?? 'L1');
        const nextAt = (0, karmaEngine_js_1.nextLevelThreshold)(level);
        const toNext = (0, karmaEngine_js_1.karmaToNextLevel)(profile.activeKarma);
        // Compute decay warning: days since last activity
        let decayWarning = null;
        if (profile.lastActivityAt) {
            const daysSince = Math.floor((Date.now() - new Date(profile.lastActivityAt).getTime()) / 86400000);
            if (daysSince >= 30) {
                decayWarning = `No activity for ${daysSince} days. Your karma will start decaying soon.`;
            }
        }
        res.json({
            userId: profile.userId,
            lifetimeKarma: profile.lifetimeKarma,
            activeKarma: profile.activeKarma,
            level: profile.level,
            conversionRate: profile.level === 'L4'
                ? 1.0
                : profile.level === 'L3'
                    ? 0.75
                    : profile.level === 'L2'
                        ? 0.5
                        : 0.25,
            eventsCompleted: profile.eventsCompleted,
            totalHours: profile.totalHours,
            trustScore: profile.trustScore,
            badges: profile.badges,
            nextLevelAt: nextAt,
            karmaToNextLevel: toNext,
            decayWarning,
            levelHistory: profile.levelHistory,
        });
    }
    catch (err) {
        logger_js_1.logger.error('Error fetching karma profile', { error: err });
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * GET /api/karma/user/:userId/history
 * Returns the conversion history for a user, most recent first.
 */
router.get('/user/:userId/history', auth_js_1.requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
        const history = await (0, karmaService_js_1.getKarmaHistory)(userId, limit);
        res.json({ history });
    }
    catch (err) {
        logger_js_1.logger.error('Error fetching karma history', { error: err });
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * GET /api/karma/user/:userId/level
 * Returns level, conversion rate, and next-level threshold for a user.
 */
router.get('/user/:userId/level', auth_js_1.requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const levelInfo = await (0, karmaService_js_1.getLevelInfo)(userId);
        res.json(levelInfo);
    }
    catch (err) {
        logger_js_1.logger.error('Error fetching level info', { error: err });
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * POST /api/karma/decay-all
 * Admin-only: trigger decay across all profiles.
 */
router.post('/decay-all', adminAuth_js_1.requireAdminAuth, async (_req, res) => {
    try {
        logger_js_1.logger.info('Manual decay job triggered via API');
        const result = await (0, karmaService_js_1.applyDecayToAll)();
        res.json({
            success: true,
            processed: result.processed,
            decayed: result.decayed,
            levelDrops: result.levelDrops,
        });
    }
    catch (err) {
        logger_js_1.logger.error('Error running decay job', { error: err });
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=karmaRoutes.js.map