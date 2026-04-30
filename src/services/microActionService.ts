// @ts-nocheck
// @ts-ignore
/**
 * MicroAction Service — daily engagement action registry
 *
 * Manages the micro-action lifecycle:
 * - Defines available actions and their karma rewards
 * - Returns actions available for a user (not yet completed today)
 * - Completes actions and awards karma
 */
import moment from 'moment';
import mongoose from 'mongoose';
import { MicroAction } from '../models/index.js';
import type { MicroActionDocument, MicroActionType } from '../models/MicroAction.js';
import { KarmaProfile } from '../models/index.js';
import { logger } from '../config/logger.js';
import { emitKarmaAwardedEvent } from '../utils/gamificationBridge.js';
import type { KarmaLevel as Level } from '../shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicroActionDefinition {
  actionKey: string;
  actionType: MicroActionType;
  name: string;
  description: string;
  karmaBonus: number;
  icon?: string;
}

export interface CompleteActionResult {
  earned: boolean;
  karma: number;
  action: MicroActionDefinition | null;
  isNew: boolean;
}

export interface UserActionStatus {
  action: MicroActionDefinition;
  completed: boolean;
  completedAt?: Date;
  earnedKarma?: number;
}

// ---------------------------------------------------------------------------
// Daily Actions Registry
// ---------------------------------------------------------------------------

/**
 * All available micro-actions with their karma bonuses.
 * Each action has a unique actionKey that encodes its daily slot.
 */
export const MICRO_ACTIONS_REGISTRY: MicroActionDefinition[] = [
  {
    actionKey: 'share_impact',
    actionType: 'share',
    name: 'Share Your Impact',
    description: 'Share your impact report with friends',
    karmaBonus: 5,
    icon: 'share',
  },
  {
    actionKey: 'daily_checkin',
    actionType: 'checkin',
    name: 'Daily Check-in',
    description: 'Open the app and check in',
    karmaBonus: 3,
    icon: 'calendar-check',
  },
  {
    actionKey: 'refer_friend',
    actionType: 'referral',
    name: 'Refer a Friend',
    description: 'Invite a friend to join ReZ',
    karmaBonus: 20,
    icon: 'user-plus',
  },
  {
    actionKey: 'complete_profile',
    actionType: 'profile',
    name: 'Complete Your Profile',
    description: 'Fill in all profile fields',
    karmaBonus: 10,
    icon: 'user-check',
  },
  {
    actionKey: 'join_discord',
    actionType: 'community',
    name: 'Join the Community',
    description: 'Join our Discord community',
    karmaBonus: 8,
    icon: 'message-circle',
  },
  {
    actionKey: 'first_event_month',
    actionType: 'event',
    name: 'First Event of the Month',
    description: 'Join your first event this month',
    karmaBonus: 15,
    icon: 'star',
  },
  {
    actionKey: 'streak_7',
    actionType: 'streak',
    name: '7-Day Streak',
    description: 'Maintain activity for 7 consecutive days',
    karmaBonus: 10,
    icon: 'zap',
  },
  {
    actionKey: 'streak_30',
    actionType: 'streak',
    name: '30-Day Streak',
    description: 'Maintain activity for 30 consecutive days',
    karmaBonus: 50,
    icon: 'flame',
  },
  // ── NBKC Civic Actions ────────────────────────────────────────────────────────
  {
    actionKey: 'civic_litter_pickup',
    actionType: 'civic',
    name: 'Pick Up Litter',
    description: 'Pick up litter in your neighborhood and dispose properly',
    karmaBonus: 5,
    icon: 'trash-2',
  },
  {
    actionKey: 'civic_adopt_sapling',
    actionType: 'civic',
    name: 'Adopt a Sapling',
    description: 'Plant or adopt a sapling and commit to caring for it',
    karmaBonus: 15,
    icon: 'leaf',
  },
  {
    actionKey: 'civic_waste_pledge',
    actionType: 'civic',
    name: 'Waste Segregation Pledge',
    description: 'Commit to proper waste segregation at home for 7 days',
    karmaBonus: 10,
    icon: 'recycle',
  },
  {
    actionKey: 'civic_water_conservation',
    actionType: 'civic',
    name: 'Water Conservation Day',
    description: 'Track and reduce water usage for a day',
    karmaBonus: 8,
    icon: 'droplet',
  },
];

// Action lookup map for O(1) access
const ACTIONS_BY_KEY = new Map<string, MicroActionDefinition>(
  MICRO_ACTIONS_REGISTRY.map((a) => [a.actionKey, a]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the daily action key for a given base action key.
 * Format: {baseKey}_{YYYY-MM-DD}
 */
export function getDailyActionKey(baseKey: string): string {
  return `${baseKey}_${moment().format('YYYY-MM-DD')}`;
}

/**
 * Get start of today in UTC for consistent date filtering.
 */
function getStartOfToday(): Date {
  return moment.utc().startOf('day').toDate();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all available micro-actions for a user.
 * Returns actions the user hasn't completed today.
 */
export async function getAvailableActions(userId: string): Promise<MicroActionDefinition[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return MICRO_ACTIONS_REGISTRY;
  }

  const startOfToday = getStartOfToday();

  // Get all actions completed today by this user
  const completedToday = await MicroAction.find({
    userId: new mongoose.Types.ObjectId(userId),
    completedAt: { $gte: startOfToday },
  }).lean();

  const completedKeys = new Set<string>(
    completedToday.map((a) => {
      // actionKey format: {baseKey}_{YYYY-MM-DD} (date uses hyphens, not underscores)
      // Strip the trailing date suffix by removing the last 11 chars (underscore + 10-char date)
      const last11 = a.actionKey.slice(-11);
      if (last11.startsWith('_') && /\d{4}-\d{2}-\d{2}/.test(last11.slice(1))) {
        return a.actionKey.slice(0, -11);
      }
      return a.actionKey;
    }),
  );

  // Filter out actions that have been completed today
  return MICRO_ACTIONS_REGISTRY.filter((action) => !completedKeys.has(action.actionKey));
}

/**
 * Get completion status for all actions.
 */
export async function getUserActionStatus(userId: string): Promise<UserActionStatus[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return MICRO_ACTIONS_REGISTRY.map((a) => ({ action: a, completed: false }));
  }

  const startOfToday = getStartOfToday();

  const completedToday = await MicroAction.find({
    userId: new mongoose.Types.ObjectId(userId),
    completedAt: { $gte: startOfToday },
  }).lean();

  const completedMap = new Map<string, MicroActionDocument>(
    completedToday.map((a) => [a.actionKey, a as unknown as MicroActionDocument]),
  );

  return MICRO_ACTIONS_REGISTRY.map((action) => {
    const completed = completedMap.get(action.actionKey);
    return {
      action,
      completed: !!completed,
      completedAt: completed?.completedAt,
      earnedKarma: completed?.karmaBonus,
    };
  });
}

/**
 * Complete a micro-action for a user.
 * Returns whether karma was earned (false if already completed today).
 */
export async function completeAction(
  userId: string,
  actionKey: string,
): Promise<CompleteActionResult> {
  const action = ACTIONS_BY_KEY.get(actionKey);
  if (!action) {
    logger.warn(`[MicroAction] Unknown action key: ${actionKey}`);
    return { earned: false, karma: 0, action: null, isNew: false };
  }

  const dailyKey = getDailyActionKey(actionKey);

  const { isNew, action: microAction } = await MicroAction.completeDaily(
    userId,
    action.actionType,
    dailyKey,
    action.karmaBonus,
    { baseActionKey: actionKey },
  );

  if (!isNew || !microAction) {
    logger.debug(`[MicroAction] User ${userId} already completed ${actionKey} today`);
    return { earned: false, karma: 0, action, isNew: false };
  }

  // Credit karma to user's profile
  try {
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

    logger.info(`[MicroAction] User ${userId} completed ${actionKey}, earned ${action.karmaBonus} karma`);
  } catch (err) {
    logger.error(`[MicroAction] Failed to credit karma for user ${userId}`, { error: err });
    // Still return success since the action was recorded
  }

  return { earned: true, karma: action.karmaBonus, action, isNew: true };
}

/**
 * Check if all daily actions are complete for a user.
 */
export async function isDailyComplete(userId: string): Promise<boolean> {
  const available = await getAvailableActions(userId);
  return available.length === 0;
}

/**
 * Get total karma earned from micro-actions today.
 */
export async function getTodayEarnings(userId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return 0;
  }

  const startOfToday = getStartOfToday();

  const completedToday = await MicroAction.find({
    userId: new mongoose.Types.ObjectId(userId),
    completedAt: { $gte: startOfToday },
  }).lean();

  return completedToday.reduce((sum, a) => sum + a.karmaBonus, 0);
}
