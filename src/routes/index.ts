import { Router, Request, Response } from 'express';
import healthRouter from './health';
import { requireAuth } from './middleware/auth.js';

const router = Router();

// Health check route — GET /health (additional to /health already in index.ts)
router.use('/health', healthRouter);

// NOTE: All /api/karma/* routes are mounted directly in index.ts via:
//   app.use('/api/karma', karmaRoutes);
//   app.use('/api/karma/verify', verifyRoutes);
//   app.use('/api/karma/batch', batchRoutes);
// This routes/index.ts (mounted at /) only handles paths not covered by those mounts.

// Leaderboard — GET /api/karma/leaderboard (Phase 2)
// G-KS-C5 FIX: Add requireAuth to prevent unauthenticated access.
router.get('/api/karma/leaderboard', requireAuth, (_req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

// Feed — GET /api/karma/feed (Phase 2)
// G-KS-C5 FIX: Add requireAuth to prevent unauthenticated access.
router.get('/api/karma/feed', requireAuth, (_req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'Phase 2 — not yet implemented' });
});

export default router;
