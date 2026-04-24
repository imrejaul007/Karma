/**
 * Wallet Routes — Karma wallet balance and transaction history
 *
 * GET  /api/karma/wallet/balance       — karma points + rez coins balance
 * GET  /api/karma/wallet/transactions — transaction history
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { walletServiceUrl } from '../config/index.js';
import { getKarmaBalance } from '../services/walletIntegration.js';
import { logger } from '../config/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/karma/wallet/balance
// ---------------------------------------------------------------------------

router.get('/wallet/balance', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { coinType = 'all' } = req.query;

    if (!process.env.INTERNAL_SERVICE_KEY && !process.env.INTERNAL_SERVICE_TOKEN) {
      res.status(503).json({ success: false, message: 'Wallet service not configured' });
      return;
    }

    const internalKey = process.env.INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_TOKEN;

    let karmaPoints = 0;
    let rezCoins = 0;
    const brandedCoins: Record<string, number> = {};

    try {
      karmaPoints = await getKarmaBalance(userId);
    } catch (err) {
      logger.warn('[walletRoutes] Failed to fetch karma balance', { userId, error: err });
      karmaPoints = 0;
    }

    // If coinType is 'all' or 'rez_coins', also fetch rez coins
    if (coinType === 'all' || coinType === 'rez_coins') {
      try {
        const { default: axios } = await import('axios');
        const response = await axios.get<{ coins?: Array<{ type: string; amount: number }> }>(
          `${walletServiceUrl}/internal/balance`,
          {
            params: { userId, coinType: 'rez_coins' },
            headers: { 'X-Internal-Token': internalKey },
            timeout: 3000,
          },
        );
        for (const coin of response.data.coins ?? []) {
          if (coin.type === 'rez_coins') {
            rezCoins = coin.amount;
          } else if (coin.type !== 'karma_points') {
            brandedCoins[coin.type] = coin.amount;
          }
        }
      } catch (err) {
        logger.warn('[walletRoutes] Failed to fetch rez coins balance', { userId, error: err });
        rezCoins = 0;
      }
    }

    res.json({
      success: true,
      balance: {
        karmaPoints,
        rezCoins,
        brandedCoins: Object.keys(brandedCoins).length > 0 ? brandedCoins : undefined,
      },
    });
  } catch (err) {
    logger.error('[walletRoutes] GET /wallet/balance error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch wallet balance' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/wallet/transactions
// ---------------------------------------------------------------------------

router.get('/wallet/transactions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { coinType = 'all', page = '1' } = req.query;
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limit = 20;
    const skip = (pageNum - 1) * limit;

    if (!process.env.INTERNAL_SERVICE_KEY && !process.env.INTERNAL_SERVICE_TOKEN) {
      res.status(503).json({ success: false, message: 'Wallet service not configured' });
      return;
    }

    const internalKey = process.env.INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_TOKEN;

    try {
      const { default: axios } = await import('axios');
      const response = await axios.get<{
        transactions?: Array<{
          _id: string;
          type: string;
          coinType: string;
          amount: number;
          description: string;
          eventId?: string;
          batchId?: string;
          createdAt: string;
        }>;
        total?: number;
      }>(
        `${walletServiceUrl}/internal/transactions`,
        {
          params: { userId, coinType, limit, skip },
          headers: { 'X-Internal-Token': internalKey },
          timeout: 5000,
        },
      );

      const transactions = (response.data.transactions ?? []).map((t) => ({
        _id: t._id,
        type: t.type,
        coinType: t.coinType,
        amount: t.amount,
        description: t.description,
        eventId: t.eventId,
        batchId: t.batchId,
        createdAt: t.createdAt,
      }));

      const total = response.data.total ?? transactions.length;

      res.json({
        success: true,
        transactions,
        total,
        page: pageNum,
        pages: Math.ceil(total / limit),
      });
    } catch (err) {
      logger.warn('[walletRoutes] Wallet service transactions unavailable', { userId, error: err });
      res.json({ success: true, transactions: [], total: 0, page: pageNum, pages: 0 });
    }
  } catch (err) {
    logger.error('[walletRoutes] GET /wallet/transactions error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

export default router;
