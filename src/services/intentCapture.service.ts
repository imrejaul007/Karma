/**
 * RTMN Commerce Memory: Intent Capture Service for Karma
 * Captures loyalty/rewards intents for cross-app intelligence
 */

import mongoose from 'mongoose';
import { Intent } from '../models';
import { logger } from '../config/logger';

const BASE_CONFIDENCE = 0.3;

const SIGNAL_WEIGHTS: Record<string, number> = {
  points_earned: 0.15,
  points_redeemed: 0.20,
  reward_viewed: 0.10,
  reward_redeemed: 0.40,
  tier_upgraded: 0.35,
  referral_sent: 0.25,
  spin_played: 0.15,
};

const APP_TYPE = 'loyalty';

// ── Intent Types ─────────────────────────────────────────────────────────────

export interface CaptureRewardViewParams {
  userId: string;
  rewardId: string;
  rewardName: string;
  pointsCost?: number;
}

export interface CapturePointsEarnedParams {
  userId: string;
  source: string;
  points: number;
  transactionId: string;
}

export interface CaptureRedemptionParams {
  userId: string;
  rewardId: string;
  pointsSpent: number;
  orderId?: string;
}

export interface CaptureReferralParams {
  userId: string;
  referralCode: string;
  referredUserId?: string;
}

// ── Capture Functions ────────────────────────────────────────────────────────

/**
 * Capture reward view intent
 */
export async function captureRewardView(params: CaptureRewardViewParams): Promise<void> {
  try {
    const intentKey = `reward_view_${params.rewardId}`;

    await upsertIntent({
      userId: params.userId,
      appType: APP_TYPE,
      category: 'GENERAL',
      intentKey,
      eventType: 'reward_viewed',
      metadata: {
        rewardId: params.rewardId,
        rewardName: params.rewardName,
        pointsCost: params.pointsCost,
        type: 'reward_view',
      },
    });
  } catch (error) {
    logger.error('[IntentCapture] Failed to capture reward view', { error, params });
  }
}

/**
 * Capture points earned intent
 */
export async function capturePointsEarned(params: CapturePointsEarnedParams): Promise<void> {
  try {
    const intentKey = `points_earned_${params.source}_${params.transactionId}`;

    await upsertIntent({
      userId: params.userId,
      appType: APP_TYPE,
      category: 'GENERAL',
      intentKey,
      eventType: 'points_earned',
      metadata: {
        source: params.source,
        points: params.points,
        transactionId: params.transactionId,
        type: 'points_earned',
      },
    });
  } catch (error) {
    logger.error('[IntentCapture] Failed to capture points earned', { error, params });
  }
}

/**
 * Capture reward redemption intent
 */
export async function captureRewardRedemption(params: CaptureRedemptionParams): Promise<void> {
  try {
    const intentKey = `reward_redeemed_${params.rewardId}`;

    await upsertIntent({
      userId: params.userId,
      appType: APP_TYPE,
      category: 'GENERAL',
      intentKey,
      eventType: 'reward_redeemed',
      metadata: {
        rewardId: params.rewardId,
        pointsSpent: params.pointsSpent,
        orderId: params.orderId,
        type: 'reward_redeemed',
      },
    });
  } catch (error) {
    logger.error('[IntentCapture] Failed to capture redemption', { error, params });
  }
}

/**
 * Capture referral intent
 */
export async function captureReferral(params: CaptureReferralParams): Promise<void> {
  try {
    const intentKey = `referral_${params.referralCode}`;

    await upsertIntent({
      userId: params.userId,
      appType: APP_TYPE,
      category: 'GENERAL',
      intentKey,
      eventType: 'referral_sent',
      metadata: {
        referralCode: params.referralCode,
        referredUserId: params.referredUserId,
        type: 'referral',
      },
    });
  } catch (error) {
    logger.error('[IntentCapture] Failed to capture referral', { error, params });
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

interface UpsertIntentParams {
  userId: string;
  appType: string;
  category: string;
  intentKey: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}

async function upsertIntent(params: UpsertIntentParams): Promise<void> {
  const signalWeight = SIGNAL_WEIGHTS[params.eventType] || 0.1;

  try {
    const existingIntent = await Intent.findOne({
      userId: params.userId,
      appType: params.appType,
      intentKey: params.intentKey,
    });

    if (existingIntent) {
      const recencyMultiplier = calculateRecencyMultiplier(existingIntent.lastSeenAt);
      const newConfidence = Math.min(
        1.0,
        Math.max(0.0, existingIntent.confidence + signalWeight * recencyMultiplier)
      );

      await Intent.updateOne(
        { _id: existingIntent._id },
        {
          confidence: newConfidence,
          lastSeenAt: new Date(),
          $push: {
            signals: {
              $each: [{
                eventType: params.eventType,
                weight: signalWeight,
                data: params.metadata,
                capturedAt: new Date(),
              }],
              $slice: -50,
            },
          },
        }
      );
    } else {
      await Intent.create({
        userId: params.userId,
        appType: params.appType,
        category: params.category,
        intentKey: params.intentKey,
        confidence: BASE_CONFIDENCE + signalWeight,
        status: 'ACTIVE',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        signals: [{
          eventType: params.eventType,
          weight: signalWeight,
          data: params.metadata,
          capturedAt: new Date(),
        }],
      });
    }
  } catch (error) {
    logger.debug('[IntentCapture] Upsert failed (table may not exist)', { error });
  }
}

function calculateRecencyMultiplier(lastSeenAt: Date): number {
  const daysSince = (Date.now() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSince / 30);
}

// ── Export ─────────────────────────────────────────────────────────────────

export const intentCaptureService = {
  captureRewardView,
  capturePointsEarned,
  captureRewardRedemption,
  captureReferral,
};
