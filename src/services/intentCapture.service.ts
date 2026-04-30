// @ts-ignore
/**
 * ReZ Mind Intent Capture Service — Karma
 * Captures user intent signals for the ReZ Mind intent graph.
 * Events: activity completed, reward earned, redemption started, points redeemed.
 */

const INTENT_CAPTURE_URL = process.env.INTENT_CAPTURE_URL || '';

export interface IntentCaptureParams {
  userId: string;
  eventType: string;
  category: string;
  intentKey: string;
  metadata?: Record<string, unknown>;
  appType: string;
}

export async function captureIntent(params: IntentCaptureParams): Promise<void> {
  if (!INTENT_CAPTURE_URL) return;
  try {
    await fetch(`${INTENT_CAPTURE_URL}/api/intent/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params }),
    });
  } catch {
    // Silently ignore errors — intent capture must not block business logic
  }
}

// ── Event-to-Intent Map ────────────────────────────────────────────────────────

const EVENT_TO_INTENT_MAP: Record<string, { eventType: string; category: string; intentKey: string }> = {
  // Activity completed → view (confidence 0.25)
  activity_completed: {
    eventType: 'view',
    category: 'GENERAL',
    intentKey: 'activity_completed',
  },
  // Reward earned → wishlist (confidence 0.30)
  reward_earned: {
    eventType: 'wishlist',
    category: 'GENERAL',
    intentKey: 'reward_earned',
  },
  // Redemption started → checkout_start (confidence 0.60)
  redemption_started: {
    eventType: 'checkout_start',
    category: 'GENERAL',
    intentKey: 'redemption_started',
  },
  // Points redeemed → fulfilled (confidence 1.0)
  points_redeemed: {
    eventType: 'fulfilled',
    category: 'GENERAL',
    intentKey: 'points_redeemed',
  },
};

export function track(params: {
  userId: string;
  event: string;
  appType: string;
  intentKey: string;
  properties?: Record<string, unknown>;
}): void {
  const config = EVENT_TO_INTENT_MAP[params.event];
  if (!config || !params.userId) return;
  captureIntent({ ...params, ...config }).catch(() => {});
}

// ── Domain-Specific Capture Helpers ────────────────────────────────────────────

/**
 * Track activity completed (karma event verified).
 * Called after earn record is created.
 */
export function trackActivityCompleted(userId: string, eventId: string): void {
  track({ userId, event: 'activity_completed', appType: 'karma', intentKey: `activity_${eventId}` });
}

/**
 * Track reward/perk earned (e.g. badge, perk unlocked).
 * Called when a perk is claimed or reward is granted.
 */
export function trackRewardEarned(userId: string, rewardId: string, rewardName: string): void {
  track({
    userId,
    event: 'reward_earned',
    appType: 'karma',
    intentKey: `reward_${rewardId}`,
    properties: { rewardName },
  });
}

/**
 * Track redemption process started (checkout_start).
 * Called when a user initiates redeeming karma points for a reward/perk.
 */
export function trackRedemptionStarted(userId: string, perkId: string): void {
  track({ userId, event: 'redemption_started', appType: 'karma', intentKey: `redemption_${perkId}` });
}

/**
 * Track points redeemed (fulfilled).
 * Called after batch conversion credits coins to user wallet.
 */
export function trackPointsRedeemed(userId: string, recordId: string, karmaAmount: number): void {
  track({
    userId,
    event: 'points_redeemed',
    appType: 'karma',
    intentKey: `points_${recordId}`,
    properties: { karmaAmount },
  });
}
