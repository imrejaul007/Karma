// @ts-nocheck
// @ts-ignore
import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'rez-karma-service',
  });
});

export default router;
