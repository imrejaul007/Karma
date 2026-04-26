// ── Karma Chat Service ──────────────────────────────────────────────────────────────
// Gamification & rewards chat actions

import { logger } from '../../config/logger.js';

export interface KarmaContext {
  userId: string;
  currentTier?: 'bronze' | 'silver' | 'gold' | 'platinum';
  totalPoints: number;
  streak?: number;
}

export interface KarmaAction {
  type: 'show_balance' | 'show_rewards' | 'show_missions' | 'show_leaderboard' | 'claim_reward' | 'view_achievements' | 'check_streak';
  payload?: Record<string, unknown>;
}

// ── Karma Chat Handler ──────────────────────────────────────────────────────

export class KarmaChatHandler {
  /**
   * Handle Karma-specific chat actions
   */
  async handleAction(
    action: KarmaAction,
    context: KarmaContext
  ): Promise<{ success: boolean; data?: unknown; message: string }> {
    const { type, payload } = action;

    try {
      switch (type) {
        case 'show_balance':
          return this.handleShowBalance(context);
        case 'show_rewards':
          return await this.handleShowRewards(payload, context);
        case 'show_missions':
          return await this.handleShowMissions(context);
        case 'show_leaderboard':
          return await this.handleShowLeaderboard(payload, context);
        case 'claim_reward':
          return await this.handleClaimReward(payload, context);
        case 'view_achievements':
          return await this.handleViewAchievements(context);
        case 'check_streak':
          return this.handleCheckStreak(context);
        default:
          return { success: false, message: `Unknown action: ${type}` };
      }
    } catch (error) {
      logger.error(`Karma action failed: ${type}`, { error });
      return { success: false, message: 'Action failed. Please try again.' };
    }
  }

  // ── Balance ──────────────────────────────────────────────────────

  private handleShowBalance(context: KarmaContext): { success: boolean; data?: unknown; message: string } {
    const tierEmoji = {
      bronze: '🥉',
      silver: '🥈',
      gold: '🏆',
      platinum: '💎',
    };

    return {
      success: true,
      message: `You have ${context.totalPoints} karma points! ${tierEmoji[context.currentTier || 'bronze']} ${context.currentTier?.toUpperCase()} tier`,
      data: {
        points: context.totalPoints,
        tier: context.currentTier,
        streak: context.streak || 0,
        pointsToNextTier: this.getPointsToNextTier(context),
      },
    };
  }

  // ── Rewards ──────────────────────────────────────────────────────

  private async handleShowRewards(
    payload: Record<string, unknown> | undefined,
    context: KarmaContext
  ): Promise<{ success: boolean; data?: unknown; message: string }> {
    const { category } = payload || {};

    const rewards = [
      { id: 'r1', name: '₹10 Off Coupon', pointsCost: 100, category: 'coupon' },
      { id: 'r2', name: '₹50 Off Coupon', pointsCost: 400, category: 'coupon' },
      { id: 'r3', name: 'Free Delivery', pointsCost: 50, category: 'delivery' },
      { id: 'r4', name: 'Priority Support', pointsCost: 200, category: 'vip' },
      { id: 'r5', name: 'Double Points Day', pointsCost: 150, category: 'booster' },
    ];

    const filtered = category ? rewards.filter(r => r.category === category) : rewards;

    return {
      success: true,
      message: `Available rewards${category ? ` in ${category}` : ''}:`,
      data: {
        rewards: filtered,
        userPoints: context.totalPoints,
        redeemable: filtered.filter(r => r.pointsCost <= context.totalPoints),
      },
    };
  }

  // ── Missions ──────────────────────────────────────────────────────

  private async handleShowMissions(context: KarmaContext): Promise<{ success: boolean; data?: unknown; message: string }> {
    const missions = [
      {
        id: 'daily_order',
        title: 'Place an order',
        description: 'Order food or book a hotel',
        points: 25,
        progress: 0,
        maxProgress: 1,
        type: 'daily',
      },
      {
        id: 'daily_review',
        title: 'Write a review',
        description: 'Share your experience',
        points: 15,
        progress: 0,
        maxProgress: 1,
        type: 'daily',
      },
      {
        id: 'weekly_spend',
        title: 'Weekly Spender',
        description: 'Spend ₹500 this week',
        points: 100,
        progress: 0,
        maxProgress: 50000, // paise
        type: 'weekly',
      },
    ];

    return {
      success: true,
      message: "Your daily missions. Complete them to earn bonus points!",
      data: {
        missions,
        dailyComplete: missions.filter(m => m.type === 'daily' && m.progress >= m.maxProgress).length,
        dailyTotal: missions.filter(m => m.type === 'daily').length,
      },
    };
  }

  // ── Leaderboard ──────────────────────────────────────────────────────

  private async handleShowLeaderboard(
    payload: Record<string, unknown> | undefined,
    context: KarmaContext
  ): Promise<{ success: boolean; data?: unknown; message: string }> {
    const { type } = payload || { type: 'weekly' };

    return {
      success: true,
      message: `Top karma earners this ${type}`,
      data: {
        type,
        entries: [], // Would fetch from karma service
        userRank: 0,
        userPoints: context.totalPoints,
      },
    };
  }

  // ── Claim Reward ──────────────────────────────────────────────────────

  private async handleClaimReward(
    payload: Record<string, unknown> | undefined,
    context: KarmaContext
  ): Promise<{ success: boolean; data?: unknown; message: string }> {
    const { rewardId } = payload || {};

    if (!rewardId) {
      return { success: false, message: 'Reward ID required' };
    }

    // Check if user has enough points
    const rewardCost = 100; // Would fetch from DB
    if (context.totalPoints < rewardCost) {
      return {
        success: false,
        message: `Not enough points. You need ${rewardCost - context.totalPoints} more points.`,
      };
    }

    return {
      success: true,
      message: 'Reward claimed! Check your wallet.',
      data: {
        rewardId,
        pointsDeducted: rewardCost,
        newBalance: context.totalPoints - rewardCost,
        couponCode: `KARMA${Date.now()}`,
      },
    };
  }

  // ── Achievements ──────────────────────────────────────────────────────

  private async handleViewAchievements(context: KarmaContext): Promise<{ success: boolean; data?: unknown; message: string }> {
    const achievements = [
      { id: 'first_order', title: 'First Order', description: 'Placed your first order', unlocked: false, points: 50 },
      { id: 'foodie', title: 'Foodie', description: 'Ordered from 10 restaurants', unlocked: false, points: 100 },
      { id: 'explorer', title: 'Explorer', description: 'Stayed at 5 hotels', unlocked: false, points: 150 },
      { id: 'loyal', title: 'Loyal Customer', description: 'Made 50 orders', unlocked: false, points: 500 },
    ];

    return {
      success: true,
      message: 'Your achievements',
      data: {
        achievements,
        unlockedCount: achievements.filter(a => a.unlocked).length,
        totalPointsFromAchievements: achievements.filter(a => a.unlocked).reduce((sum, a) => sum + a.points, 0),
      },
    };
  }

  // ── Streak ──────────────────────────────────────────────────────

  private handleCheckStreak(context: KarmaContext): { success: boolean; data?: unknown; message: string } {
    const streak = context.streak || 0;
    const streakBonus = Math.min(streak * 5, 50); // 5 points per day, max 50

    return {
      success: true,
      message: streak > 0
        ? `You're on a ${streak}-day streak! Earn ${streakBonus} bonus points today.`
        : "Start your streak today! Complete a mission to begin.",
      data: {
        currentStreak: streak,
        maxStreak: streak, // Would fetch from DB
        bonusPoints: streakBonus,
        streakMilestones: [3, 7, 14, 30],
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private getPointsToNextTier(context: KarmaContext): number {
    const tiers = { bronze: 0, silver: 500, gold: 2000, platinum: 5000 };
    const nextTier = context.currentTier === 'bronze' ? 'silver'
      : context.currentTier === 'silver' ? 'gold'
      : context.currentTier === 'gold' ? 'platinum'
      : null;

    return nextTier ? tiers[nextTier] - context.totalPoints : 0;
  }
}

export const karmaChatHandler = new KarmaChatHandler();
export default karmaChatHandler;
