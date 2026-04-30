// @ts-nocheck
// @ts-ignore
/**
 * Perk Routes — Karma perk/reward redemption
 *
 * POST /api/karma/perks/:perkId/claim  — start redemption (checkout_start intent)
 * GET  /api/karma/perks/:perkId        — get perk details
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../config/logger.js';
import { trackRedemptionStarted } from '../services/intentCapture.service.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/karma/perks/:perkId/claim — start perk redemption (checkout_start)
// ---------------------------------------------------------------------------

router.post('/perks/:perkId/claim', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { perkId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(perkId)) {
      res.status(400).json({ success: false, message: 'Invalid perkId format' });
      return;
    }

    // Track intent — redemption started (checkout_start)
    trackRedemptionStarted(userId, perkId);

    logger.info('[perkRoutes] Redemption started', { userId, perkId });

    res.json({ success: true, message: 'Redemption initiated', perkId });
  } catch (err) {
    logger.error('[perkRoutes] POST /perks/claim error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ success: false, message: 'Failed to initiate redemption' });
  }
});

export default router;
