// -nocheck
// @ts-ignore
/**
 * Notification Routes — device registration for push notifications
 *
 * Base path: /api/karma/notifications
 *
 * POST /api/karma/notifications/register  — Register FCM device token
 * DELETE /api/karma/notifications/unregister — Unregister FCM device token
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { UserDevice, type DevicePlatform } from '../models/UserDevice.js';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { logger } from '../config/logger.js';

const router = Router();

/**
 * POST /api/karma/notifications/register
 * Register or update FCM device token for push notifications.
 *
 * Body: { fcmToken: string, platform?: 'ios' | 'android' | 'web' }
 */
router.post('/register', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const { fcmToken, platform } = req.body as {
      fcmToken?: string;
      platform?: DevicePlatform;
    };

    if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim().length === 0) {
      res.status(400).json({ success: false, message: 'fcmToken is required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const validPlatforms: DevicePlatform[] = ['ios', 'android', 'web'];
    const devicePlatform: DevicePlatform = platform && validPlatforms.includes(platform)
      ? platform
      : 'android';

    // Update UserDevice model (preferred)
    await UserDevice.updateToken(userId, fcmToken.trim(), devicePlatform);

    // Also update KarmaProfile.fcmToken as fallback (legacy)
    await KarmaProfile.updateOne(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $set: { fcmToken: fcmToken.trim() } },
    );

    logger.info('[NotificationRoutes] FCM token registered', {
      userId,
      platform: devicePlatform,
      tokenPrefix: fcmToken.slice(0, 10),
    });

    res.json({ success: true, message: 'Device registered successfully' });
  } catch (err) {
    logger.error('[NotificationRoutes] POST /register error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to register device' });
  }
});

/**
 * DELETE /api/karma/notifications/unregister
 * Remove FCM device token (logout from push notifications).
 */
router.delete('/unregister', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    // Delete from UserDevice model
    await UserDevice.deleteToken(userId);

    // Also clear from KarmaProfile (legacy)
    await KarmaProfile.updateOne(
      { userId: new mongoose.Types.ObjectId(userId) },
      { $unset: { fcmToken: '' } },
    );

    logger.info('[NotificationRoutes] FCM token unregistered', { userId });

    res.json({ success: true, message: 'Device unregistered successfully' });
  } catch (err) {
    logger.error('[NotificationRoutes] DELETE /unregister error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to unregister device' });
  }
});

/**
 * GET /api/karma/notifications/status
 * Check if the current device is registered (for client-side verification).
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const device = await UserDevice.getActiveDevice(userId);

    res.json({
      success: true,
      registered: !!device,
      platform: device?.platform ?? null,
      lastActive: device?.lastActive ?? null,
    });
  } catch (err) {
    logger.error('[NotificationRoutes] GET /status error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to check status' });
  }
});

export default router;
