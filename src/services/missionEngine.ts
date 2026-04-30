/**
 * Mission Engine — evaluates badge and mission completions
 *
 * Triggers on karma events via BullMQ queue.
 * Checks which missions/badges a user just earned.
 */
import mongoose from 'mongoose';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { logger } from '../config/logger.js';
import {
  sendKarmaNotification,
  notifyBadgeEarned,
  notifyMissionComplete,
} from './notificationService.js';
import { trackRewardEarned } from './intentCapture.service.js';
import type { IKarmaProfile, IBadge } from '../models/index.js';

// ── Badge Definitions ───────────────────────────────────────────────────────

export const BADGE_DEFINITIONS: Record<string, {
  name: string;
  icon: string;
  description: string;
  condition: (profile: IKarmaProfile) => boolean;
  karmaBonus?: number;
}> = {
  FIRST_STEP: {
    name: 'First Step',
    icon: '🌱',
    description: 'Complete your first impact event',
    condition: (p) => (p.eventsCompleted ?? 0) >= 1,
  },
  CLIMATE_WARRIOR: {
    name: 'Climate Warrior',
    icon: '🌍',
    description: 'Complete 5 environment events',
    condition: (p) => (p.environmentEvents ?? 0) >= 5,
  },
  FOOD_HERO: {
    name: 'Food Hero',
    icon: '🍛',
    description: 'Complete 5 food drive events',
    condition: (p) => (p.foodEvents ?? 0) >= 5,
  },
  HEALTH_CHAMPION: {
    name: 'Health Champion',
    icon: '🏥',
    description: 'Complete 5 health camp events',
    condition: (p) => (p.healthEvents ?? 0) >= 5,
  },
  EDUCATOR: {
    name: 'Educator',
    icon: '📚',
    description: 'Complete 5 education events',
    condition: (p) => (p.educationEvents ?? 0) >= 5,
  },
  COMMUNITY_PILLAR: {
    name: 'Community Pillar',
    icon: '🤝',
    description: 'Complete 5 community events',
    condition: (p) => (p.communityEvents ?? 0) >= 5,
  },
  STREAK_7: {
    name: '7-Day Streak',
    icon: '🔥',
    description: 'Maintain a 7-day impact streak',
    condition: (p) => (p.currentStreak ?? 0) >= 7,
    karmaBonus: 5,
  },
  STREAK_30: {
    name: '30-Day Warrior',
    icon: '⚡',
    description: 'Maintain a 30-day impact streak',
    condition: (p) => (p.currentStreak ?? 0) >= 30,
    karmaBonus: 25,
  },
  HUNDRED_HOUR: {
    name: '100 Hour Hero',
    icon: '⏰',
    description: 'Contribute 100 volunteer hours',
    condition: (p) => (p.totalHours ?? 0) >= 100,
    karmaBonus: 50,
  },
  FIVE_HUNDRED_HOUR: {
    name: '500 Hour Legend',
    icon: '🏆',
    description: 'Contribute 500 volunteer hours',
    condition: (p) => (p.totalHours ?? 0) >= 500,
    karmaBonus: 100,
  },
  IMPACT_LEADER: {
    name: 'Impact Leader',
    icon: '💎',
    description: 'Reach Impact Leader band (KarmaScore 750+)',
    condition: (p) => (p.karmaScore?.band ?? '') === 'leader',
    karmaBonus: 20,
  },
  CIVIC_ELITE: {
    name: 'Civic Elite',
    icon: '👑',
    description: 'Reach Civic Elite band (KarmaScore 820+)',
    condition: (p) => (p.karmaScore?.band ?? '') === 'elite',
    karmaBonus: 50,
  },
  PINNACLE: {
    name: 'Pinnacle',
    icon: '🌟',
    description: 'Achieve the Pinnacle KarmaScore (900)',
    condition: (p) => (p.karmaScore?.total ?? 0) >= 900,
    karmaBonus: 200,
  },
  CROSS_CATEGORY: {
    name: 'All-Rounder',
    icon: '🎯',
    description: 'Participate in all 5 event categories',
    condition: (p) => {
      const cats = p.uniqueCategories ?? [];
      return cats.length >= 5;
    },
    karmaBonus: 15,
  },
  HARD_EVENT: {
    name: 'Iron Will',
    icon: '💪',
    description: 'Complete a hard-difficulty event',
    condition: (p) => (p.hardEvents ?? 0) >= 1,
    karmaBonus: 10,
  },
};

// ── Evaluate Badges ──────────────────────────────────────────────────────────

/**
 * Check which badges a user has newly earned.
 * Call this after addKarma() or after score computation.
 */
export async function evaluateBadges(userId: string): Promise<string[]> {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) return [];
    const profile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    if (!profile) return [];

    const earnedIds = new Set((profile.badges ?? []).map((b: IBadge) => b.id));
    const newlyEarned: string[] = [];

    for (const [badgeId, def] of Object.entries(BADGE_DEFINITIONS)) {
      if (earnedIds.has(badgeId)) continue;

      if (def.condition(profile)) {
        await KarmaProfile.updateOne(
          { _id: profile._id },
          {
            $push: {
              badges: {
                id: badgeId,
                name: def.name,
                icon: def.icon,
                earnedAt: new Date(),
              },
            },
          },
        );

        newlyEarned.push(badgeId);
        logger.info('[MissionEngine] Badge awarded', { userId, badgeId });

        // Track intent — reward earned (wishlist)
        trackRewardEarned(userId, badgeId, def.name);

        // Send push notification for badge earned
        notifyBadgeEarned(userId, badgeId, def.name, def.icon).catch((err) => {
          logger.warn('[MissionEngine] Badge notification failed', { userId, badgeId, error: err });
        });

        if (def.karmaBonus && def.karmaBonus > 0) {
          const { addKarma } = await import('./karmaService.js');
          await addKarma(userId, def.karmaBonus).catch(() => {});
        }
      }
    }

    return newlyEarned;
  } catch (err) {
    logger.error('[MissionEngine] Badge evaluation error', { userId, error: err });
    return [];
  }
}

// ── Mission Progress ────────────────────────────────────────────────────────

export interface MissionProgress {
  missionId: string;
  name: string;
  description: string;
  requirement: number;
  progress: number;
  isComplete: boolean;
  reward?: { karmaBonus: number; badgeId?: string };
}

/**
 * Get active missions for a user with progress
 */
export async function getActiveMissions(userId: string): Promise<MissionProgress[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return [];
  const profile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
  if (!profile) return [];

  const eventsCompleted = profile.eventsCompleted ?? 0;
  const totalHours = profile.totalHours ?? 0;
  const currentStreak = (profile as any).currentStreak ?? 0;

  const missions: MissionProgress[] = [
    {
      missionId: 'mission_first_event',
      name: 'Make an Impact',
      description: 'Complete your first impact event',
      requirement: 1,
      progress: Math.min(eventsCompleted, 1),
      isComplete: eventsCompleted >= 1,
      reward: { karmaBonus: 5 },
    },
    {
      missionId: 'mission_10_events',
      name: 'Dedicated Volunteer',
      description: 'Complete 10 impact events',
      requirement: 10,
      progress: Math.min(eventsCompleted, 10),
      isComplete: eventsCompleted >= 10,
      reward: { karmaBonus: 20 },
    },
    {
      missionId: 'mission_50_hours',
      name: 'Hour Milestone',
      description: 'Contribute 50 volunteer hours',
      requirement: 50,
      progress: Math.min(totalHours, 50),
      isComplete: totalHours >= 50,
      reward: { karmaBonus: 30 },
    },
    {
      missionId: 'mission_7_streak',
      name: 'Week Warrior',
      description: 'Maintain a 7-day impact streak',
      requirement: 7,
      progress: Math.min(currentStreak, 7),
      isComplete: currentStreak >= 7,
      reward: { karmaBonus: 10 },
    },
  ];

  return missions;
}

/**
 * Check and award mission completions
 */
export async function evaluateMissions(userId: string): Promise<string[]> {
  const missions = await getActiveMissions(userId);
  const newlyCompleted: string[] = [];

  for (const mission of missions) {
    if (mission.isComplete && mission.reward?.karmaBonus) {
      try {
        const { addKarma } = await import('./karmaService.js');
        await addKarma(userId, mission.reward.karmaBonus).catch(() => {});
        newlyCompleted.push(mission.missionId);
        logger.info('[MissionEngine] Mission completed', { userId, missionId: mission.missionId });

        // Send push notification for mission completion
        notifyMissionComplete(userId, mission.missionId, mission.name).catch((err) => {
          logger.warn('[MissionEngine] Mission notification failed', { userId, missionId: mission.missionId, error: err });
        });
      } catch { /* non-fatal */ }
    }
  }

  return newlyCompleted;
}
