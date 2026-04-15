import { Router } from 'express';
import healthRouter from './health';

const router = Router();

// Health check route — GET /health (additional to /health already in index.ts)
router.use('/health', healthRouter);

// NOTE: All /api/karma/* routes are mounted directly in index.ts via:
//   app.use('/api/karma', karmaRoutes);
//   app.use('/api/karma/verify', verifyRoutes);
//   app.use('/api/karma/batch', batchRoutes);
// This routes/index.ts (mounted at /) only handles paths not covered by those mounts.

// Leaderboard — GET /api/karma/leaderboard (Phase 2)
router.get('/api/karma/leaderboard', (_req, res) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

// Feed — GET /api/karma/feed (Phase 2)
router.get('/api/karma/feed', (_req, res) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

export default router;
