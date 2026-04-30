// @ts-ignore
/**
 * MicroAction Engine — evaluates user activity triggers
 *
 * Called after any user activity to check which micro-actions were triggered.
 * Handles automatic action completion for triggers like app_open, profile_update, etc.
 *
 * Design: This engine is event-driven. When a trigger event occurs,
 * it maps the trigger to eligible actions and auto-completes them.
 */
import mongoose from 'mongoose';
import moment from 'moment';
import { MicroAction } from '../models/index.js';
import { KarmaProfile } from '../models/index.js';
import { getDailyActionKey, MICRO_ACTIONS_REGISTRY } from '../services/microActionService.js';
import { logger } from '../config/logger.js';
import { emitKarmaAwardedEvent } from '../utils/gamificationBridge.js';
import type { KarmaLevel as Level } from '../shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MicroActionTrigger =
  | 'app_open'
  | 'profile_update'
  | 'referral_credited'
  | 'event_completed'
  | 'streak_updated'
  | 'share_click'
  | 'civic_action';

interface TriggerResult {
  actionKey: string;
  triggered: boolean;
  karmaEarned: number;
}

interface EvaluateResult {
  newActions: string[];
  bonusKarma: number;
}

// ---------------------------------------------------------------------------
// Trigger Mapping
// ---------------------------------------------------------------------------

/**
 * Maps triggers to their eligible action keys.
 */
const TRIGGER_ACTION_MAP: Record<MicroActionTrigger, string[]> = {
  app_open: ['daily_checkin'],
  profile_update: ['complete_profile'],
  referral_credited: ['refer_friend'],
  event_completed: ['first_event_month'],
  streak_updated: ['streak_7', 'streak_30'],
  share_click: ['share_impact'],
  // NBKC Civic Actions
  civic_action: ['civic_litter_pickup', 'civic_adopt_sapling', 'civic_waste_pledge', 'civic_water_conservation'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStartOfToday(): Date {
  return moment.utc().startOf('day').toDate();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate micro-actions triggered by user activity.
 *
 * @param userId - The user ID
 * @param trigger - The activity trigger type
 * @returns Results showing which actions were newly completed
 */
export async function evaluateMicroActions(
  userId: string,
  trigger: MicroActionTrigger,
): Promise<EvaluateResult> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { newActions: [], bonusKarma: 0 };
  }

  const eligibleKeys = TRIGGER_ACTION_MAP[trigger] ?? [];
  if (eligibleKeys.length === 0) {
    return { newActions: [], bonusKarma: 0 };
  }

  const startOfToday = getStartOfToday();
  const results: TriggerResult[] = [];
  let totalBonusKarma = 0;

  for (const baseKey of eligibleKeys) {
    const action = MICRO_ACTIONS_REGISTRY.find((a) => a.actionKey === baseKey);
    if (!action) continue;

    // Check if already completed today
    const dailyKey = getDailyActionKey(baseKey);
    const existing = await MicroAction.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      actionKey: dailyKey,
    }).lean();

    if (existing) {
      logger.debug(`[MicroActionEngine] ${baseKey} already completed today for user ${userId}`);
      continue;
    }

    // Complete the action
    try {
      const microAction = await MicroAction.create({
        userId: new mongoose.Types.ObjectId(userId),
        actionType: action.actionType,
        actionKey: dailyKey,
        completedAt: new Date(),
        karmaBonus: action.karmaBonus,
        metadata: { baseActionKey: baseKey, triggeredBy: trigger },
      });

      // Credit karma to profile
      const profile = await KarmaProfile.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        {
          $inc: { activeKarma: action.karmaBonus, lifetimeKarma: action.karmaBonus },
          $set: { lastActivityAt: new Date() },
        },
        { new: true },
      );

      // Emit gamification event
      await emitKarmaAwardedEvent({
        userId,
        karmaAmount: action.karmaBonus,
        eventType: 'karma.awarded',
        eventId: `micro-action-${userId}-${dailyKey}`,
        newActiveKarma: profile?.activeKarma ?? action.karmaBonus,
        newLevel: (profile?.level ?? 'L1') as Level,
      });

      results.push({
        actionKey: baseKey,
        triggered: true,
        karmaEarned: action.karmaBonus,
      });

      totalBonusKarma += action.karmaBonus;

      logger.info(
        `[MicroActionEngine] Trigger ${trigger} auto-completed ${baseKey} for user ${userId}, awarded ${action.karmaBonus} karma`,
      );
    } catch (err) {
      // Handle duplicate key gracefully (race condition)
      const mongooseErr = err as { code?: number };
      if (mongooseErr.code !== 11000) {
        logger.error(`[MicroActionEngine] Failed to complete ${baseKey} for user ${userId}`, { error: err });
      }
    }
  }

  return {
    newActions: results.filter((r) => r.triggered).map((r) => r.actionKey),
    bonusKarma: totalBonusKarma,
  };
}

/**
 * Evaluate streak-based actions for a user.
 * Called after streak update to check if 7-day or 30-day streak thresholds are met.
 */
export async function evaluateStreakActions(userId: string, currentStreak: number): Promise<EvaluateResult> {
  const results: string[] = [];
  let bonusKarma = 0;

  if (currentStreak >= 7) {
    const result7 = await evaluateMicroActions(userId, 'streak_updated');
    // The streak_7 action is in the map, check if it was triggered
    const action7 = MICRO_ACTIONS_REGISTRY.find((a) => a.actionKey === 'streak_7');
    if (result7.newActions.includes('streak_7') && action7) {
      results.push('streak_7');
      bonusKarma += action7.karmaBonus;
    }
  }

  if (currentStreak >= 30) {
    const result30 = await evaluateMicroActions(userId, 'streak_updated');
    const action30 = MICRO_ACTIONS_REGISTRY.find((a) => a.actionKey === 'streak_30');
    if (result30.newActions.includes('streak_30') && action30) {
      results.push('streak_30');
      bonusKarma += action30.karmaBonus;
    }
  }

  return { newActions: results, bonusKarma };
}

/**
 * Event handler for app open events.
 * Convenience wrapper for evaluateMicroActions with app_open trigger.
 */
export async function onAppOpen(userId: string): Promise<EvaluateResult> {
  return evaluateMicroActions(userId, 'app_open');
}

/**
 * Event handler for profile update events.
 */
export async function onProfileUpdate(userId: string): Promise<EvaluateResult> {
  return evaluateMicroActions(userId, 'profile_update');
}

/**
 * Event handler for referral credited events.
 */
export async function onReferralCredited(userId: string): Promise<EvaluateResult> {
  return evaluateMicroActions(userId, 'referral_credited');
}

/**
 * Event handler for event completion events.
 */
export async function onEventCompleted(userId: string): Promise<EvaluateResult> {
  return evaluateMicroActions(userId, 'event_completed');
}

/**
 * Event handler for share click events.
 */
export async function onShareClick(userId: string): Promise<EvaluateResult> {
  return evaluateMicroActions(userId, 'share_click');
}
