/**
 * Notification Service — push notification system for karma events
 *
 * Uses FCM (Firebase Cloud Messaging) to send push notifications to users.
 * Notifications are fire-and-forget — failures never block the parent operation.
 */
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { UserDevice } from '../models/UserDevice.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PushNotificationPayload {
  token: string; // FCM device token
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export interface NotificationEvent {
  type: 'badge_earned' | 'level_up' | 'mission_complete' | 'karma_received' | 'streak_milestone' | 'community_post';
  userId: string;
  payload: {
    badgeName?: string;
    badgeIcon?: string;
    badgeId?: string;
    newLevel?: string;
    oldLevel?: string;
    missionName?: string;
    missionId?: string;
    karmaAmount?: number;
    senderName?: string;
    streakDays?: number;
    communityName?: string;
    communitySlug?: string;
    postPreview?: string;
    postId?: string;
  };
}

// ── Level Names ────────────────────────────────────────────────────────────────

const LEVEL_NAMES: Record<string, string> = {
  L1: 'Seed',
  L2: 'Sprout',
  L3: 'Bloom',
  L4: 'Pinnacle',
};

// ── Notification Templates ─────────────────────────────────────────────────────

interface NotificationTemplate {
  title: string;
  body: (payload: NotificationEvent['payload']) => string;
  data: (payload: NotificationEvent['payload']) => Record<string, string>;
}

const NOTIFICATION_TEMPLATES: Record<NotificationEvent['type'], NotificationTemplate> = {
  badge_earned: {
    title: 'Badge Earned!',
    body: (p) => `You earned the "${p.badgeName}" badge! Keep up the great work.`,
    data: (p) => ({ type: 'badge', badgeId: p.badgeId ?? '' }),
  },
  level_up: {
    title: 'Level Up!',
    body: (p) => `Congratulations! You've reached ${p.newLevel} — ${LEVEL_NAMES[p.newLevel ?? ''] ?? 'new level'}.`,
    data: () => ({ type: 'level_up' }),
  },
  mission_complete: {
    title: 'Mission Complete!',
    body: (p) => `You completed "${p.missionName}" and earned karma!`,
    data: (p) => ({ type: 'mission', missionId: p.missionId ?? '' }),
  },
  karma_received: {
    title: 'Karma Received!',
    body: (p) => `+${p.karmaAmount ?? 0} karma${p.senderName ? ` from ${p.senderName}` : ''}`,
    data: () => ({ type: 'karma' }),
  },
  streak_milestone: {
    title: 'Streak Milestone!',
    body: (p) => `Amazing! You've maintained a ${p.streakDays}-day streak!`,
    data: (p) => ({ type: 'streak', streakDays: String(p.streakDays ?? 0) }),
  },
  community_post: {
    title: 'New Post',
    body: (p) => {
      const preview = p.postPreview?.slice(0, 50) ?? '';
      return `${p.communityName}: "${preview}..."`;
    },
    data: (p) => ({ type: 'community', communitySlug: p.communitySlug ?? '', postId: p.postId ?? '' }),
  },
};

// ── FCM Sending (Mock) ───────────────────────────────────────────────────────

/**
 * Send a push notification via FCM.
 * Currently a mock implementation — logs the notification.
 * In production: use firebase-admin SDK.
 */
async function sendPushNotification(payload: PushNotificationPayload): Promise<boolean> {
  // In production: use firebase-admin SDK
  // import admin from 'firebase-admin';
  // await admin.messaging().send({ token: payload.token, notification: { title, body }, data: payload.data });
  logger.info('[PushNotification] Sending notification', {
    token: payload.token.slice(0, 10) + '...',
    title: payload.title,
    body: payload.body,
  });
  return true;
}

// ── Token Lookup ──────────────────────────────────────────────────────────────

/**
 * Get user's FCM device token from multiple sources:
 * 1. KarmaProfile.fcmToken (legacy)
 * 2. UserDevice model (new)
 *
 * Returns null if no token is found.
 */
export async function getUserDeviceToken(userId: string): Promise<string | null> {
  try {
    // Try KarmaProfile.fcmToken first (legacy fallback)
    const profile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .select('fcmToken')
      .lean();
    if (profile?.fcmToken) {
      return profile.fcmToken;
    }

    // Fall back to UserDevice model (one active device per user)
    const device = await UserDevice.findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ lastActive: -1 })
      .lean();
    if (device?.fcmToken) {
      return device.fcmToken;
    }

    return null;
  } catch (err) {
    logger.error('[PushNotification] Error fetching device token', { userId, error: err });
    return null;
  }
}

// ── Batch Notification for Community Posts ────────────────────────────────────

const MAX_FOLLOWERS_PER_BATCH = 100;

/**
 * Send community post notifications to followers (excluding the post author).
 * Batches notifications to avoid FCM quota limits.
 */
export async function notifyFollowersOfNewPost(
  authorId: string,
  communityName: string,
  communitySlug: string,
  postId: string,
  postPreview: string,
  followerIds: string[],
): Promise<void> {
  const followersToNotify = followerIds.filter((id) => id !== authorId);

  // Process in batches of MAX_FOLLOWERS_PER_BATCH
  for (let i = 0; i < followersToNotify.length; i += MAX_FOLLOWERS_PER_BATCH) {
    const batch = followersToNotify.slice(i, i + MAX_FOLLOWERS_PER_BATCH);

    // Fire-and-forget batch — don't await to avoid blocking
    sendBatchCommunityNotifications(batch, {
      communityName,
      communitySlug,
      postId,
      postPreview,
    }).catch((err) => {
      logger.error('[PushNotification] Batch community notification failed', { error: err });
    });
  }
}

async function sendBatchCommunityNotifications(
  followerIds: string[],
  payload: { communityName: string; communitySlug: string; postId: string; postPreview: string },
): Promise<void> {
  const tokens = await Promise.all(
    followerIds.map((userId) => getUserDeviceToken(userId)),
  );

  const validTokens = tokens.filter((token): token is string => token !== null);

  if (validTokens.length === 0) return;

  const template = NOTIFICATION_TEMPLATES.community_post;
  const body = template.body({
    communityName: payload.communityName,
    communitySlug: payload.communitySlug,
    postId: payload.postId,
    postPreview: payload.postPreview,
  });
  const data = template.data({
    communityName: payload.communityName,
    communitySlug: payload.communitySlug,
    postId: payload.postId,
    postPreview: payload.postPreview,
  });

  // Send to all tokens in the batch
  await Promise.all(
    validTokens.map((token) =>
      sendPushNotification({
        token,
        title: template.title,
        body,
        data,
        sound: 'default',
      }),
    ),
  );

  logger.info('[PushNotification] Sent community post notifications', {
    count: validTokens.length,
    community: payload.communityName,
  });
}

// ── Main Notification Function ─────────────────────────────────────────────────

/**
 * Send a karma notification to a user.
 *
 * This is a fire-and-forget operation — errors are logged but never thrown.
 * Notifications should never block the parent karma operation.
 */
export async function sendKarmaNotification(event: NotificationEvent): Promise<void> {
  try {
    // Get user's device token
    const userToken = await getUserDeviceToken(event.userId);
    if (!userToken) {
      logger.debug(`[PushNotification] No FCM token for user ${event.userId}`);
      return;
    }

    const template = NOTIFICATION_TEMPLATES[event.type];
    if (!template) {
      logger.warn(`[PushNotification] Unknown notification type: ${event.type}`);
      return;
    }

    const payload: PushNotificationPayload = {
      token: userToken,
      title: template.title,
      body: template.body(event.payload),
      data: template.data(event.payload),
      sound: 'default',
    };

    await sendPushNotification(payload);
    logger.info(`[PushNotification] Sent ${event.type} notification to user ${event.userId}`);
  } catch (err) {
    // Non-fatal — notifications should never block karma operations
    logger.error(`[PushNotification] Failed to send ${event.type} notification`, {
      error: err instanceof Error ? err.message : String(err),
      userId: event.userId,
    });
  }
}

// ── Notification Helpers ───────────────────────────────────────────────────────

/**
 * Notify user of a badge earned.
 */
export async function notifyBadgeEarned(
  userId: string,
  badgeId: string,
  badgeName: string,
  badgeIcon?: string,
): Promise<void> {
  await sendKarmaNotification({
    type: 'badge_earned',
    userId,
    payload: { badgeId, badgeName, badgeIcon },
  });
}

/**
 * Notify user of a level up.
 */
export async function notifyLevelUp(
  userId: string,
  newLevel: string,
  oldLevel: string,
): Promise<void> {
  await sendKarmaNotification({
    type: 'level_up',
    userId,
    payload: { newLevel, oldLevel },
  });
}

/**
 * Notify user of a mission completion.
 */
export async function notifyMissionComplete(
  userId: string,
  missionId: string,
  missionName: string,
): Promise<void> {
  await sendKarmaNotification({
    type: 'mission_complete',
    userId,
    payload: { missionId, missionName },
  });
}

/**
 * Notify user of karma received.
 */
export async function notifyKarmaReceived(
  userId: string,
  karmaAmount: number,
  senderName?: string,
): Promise<void> {
  await sendKarmaNotification({
    type: 'karma_received',
    userId,
    payload: { karmaAmount, senderName },
  });
}

/**
 * Notify user of a streak milestone.
 */
export async function notifyStreakMilestone(
  userId: string,
  streakDays: number,
): Promise<void> {
  await sendKarmaNotification({
    type: 'streak_milestone',
    userId,
    payload: { streakDays },
  });
}
