import { Router } from 'express';
import healthRouter from './health';

const router = Router();

// Health check route — GET /health (additional to /health already in index.ts)
router.use('/health', healthRouter);

// ── Phase 2+ routes (registered as stubs, implemented in later phases) ──────────

// Karma user routes — GET /api/karma/user/:userId, POST /api/karma/earn
// (implemented by other agents in later phases)
router.use('/api/karma', (_req, res) => {
  res.status(501).json({ success: false, message: 'Not yet implemented' });
});

// Verification routes — POST /api/karma/verify/checkin, POST /api/karma/verify/checkout
router.use('/api/karma/verify', (_req, res) => {
  res.status(501).json({ success: false, message: 'Not yet implemented' });
});

// Batch routes — GET /api/karma/batch, POST /api/karma/batch/:id/preview, POST /api/karma/batch/:id/execute
router.use('/api/karma/batch', (_req, res) => {
  res.status(501).json({ success: false, message: 'Not yet implemented' });
});

// Leaderboard — GET /api/karma/leaderboard (Phase 2)
router.get('/api/karma/leaderboard', (_req, res) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

// Feed — GET /api/karma/feed (Phase 2)
router.get('/api/karma/feed', (_req, res) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

export default router;
