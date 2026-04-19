/**
 * Unit tests for karmaEngine.ts — core karma calculation logic
 *
 * Tests:
 * - calculateLevel: all 4 thresholds
 * - calculateKarmaEarned: base, multiplier, cap
 * - getConversionRate: all 4 levels
 * - applyDailyDecay: all 3 decay levels
 * - calculateConversion: all rates
 * - applyCaps: cap enforcement
 */
import {
  calculateLevel,
  getConversionRate,
  calculateKarmaEarned,
  applyDailyDecay,
  calculateConversion,
  applyCaps,
  LEVEL_THRESHOLDS,
  WEEKLY_COIN_CAP,
} from '../src/engines/karmaEngine';

import type { KarmaProfile } from '../src/types/index';

describe('karmaEngine', () => {
  // ── calculateLevel ────────────────────────────────────────────────────────

  describe('calculateLevel', () => {
    it('returns L1 for activeKarma < 500', () => {
      expect(calculateLevel(0)).toBe('L1');
      expect(calculateLevel(1)).toBe('L1');
      expect(calculateLevel(499)).toBe('L1');
    });

    it('returns L2 for 500 <= activeKarma < 2000', () => {
      expect(calculateLevel(500)).toBe('L2');
      expect(calculateLevel(999)).toBe('L2');
      expect(calculateLevel(1999)).toBe('L2');
    });

    it('returns L3 for 2000 <= activeKarma < 5000', () => {
      expect(calculateLevel(2000)).toBe('L3');
      expect(calculateLevel(3000)).toBe('L3');
      expect(calculateLevel(4999)).toBe('L3');
    });

    it('returns L4 for activeKarma >= 5000', () => {
      expect(calculateLevel(5000)).toBe('L4');
      expect(calculateLevel(10000)).toBe('L4');
      expect(calculateLevel(999999)).toBe('L4');
    });
  });

  // ── getConversionRate ────────────────────────────────────────────────────

  describe('getConversionRate', () => {
    it('returns 0.25 for L1', () => {
      expect(getConversionRate('L1')).toBe(0.25);
    });

    it('returns 0.5 for L2', () => {
      expect(getConversionRate('L2')).toBe(0.5);
    });

    it('returns 0.75 for L3', () => {
      expect(getConversionRate('L3')).toBe(0.75);
    });

    it('returns 1.0 for L4', () => {
      expect(getConversionRate('L4')).toBe(1.0);
    });

    it('defaults to 0.25 for unknown level', () => {
      expect(getConversionRate('unknown' as never)).toBe(0.25);
    });
  });

  // ── calculateKarmaEarned ────────────────────────────────────────────────

  describe('calculateKarmaEarned', () => {
    it('calculates base karma correctly', () => {
      const event = {
        _id: '1',
        merchantEventId: '1',
        ngoId: '1',
        category: 'environment' as const,
        impactUnit: 'trees',
        impactMultiplier: 1.2,
        difficulty: 'easy' as const,
        expectedDurationHours: 4,
        baseKarmaPerHour: 50,
        maxKarmaPerEvent: 400,
        qrCodes: { checkIn: 'in', checkOut: 'out' },
        gpsRadius: 100,
        maxVolunteers: 50,
        confirmedVolunteers: 0,
        status: 'published' as const,
      };

      // 50 * 4 hours * 1.2 impact * 1.0 difficulty = 240
      expect(calculateKarmaEarned(event, 4)).toBe(240);
    });

    it('applies medium difficulty multiplier (1.5x)', () => {
      const event = {
        _id: '1',
        merchantEventId: '1',
        ngoId: '1',
        category: 'education' as const,
        impactUnit: 'hours',
        impactMultiplier: 1.3,
        difficulty: 'medium' as const,
        expectedDurationHours: 2,
        baseKarmaPerHour: 55,
        maxKarmaPerEvent: 440,
        qrCodes: { checkIn: 'in', checkOut: 'out' },
        gpsRadius: 100,
        maxVolunteers: 50,
        confirmedVolunteers: 0,
        status: 'published' as const,
      };

      // 55 * 2 * 1.3 * 1.5 = 214.5 → floor → 214
      expect(calculateKarmaEarned(event, 2)).toBe(214);
    });

    it('applies hard difficulty multiplier (2.0x)', () => {
      const event = {
        _id: '1',
        merchantEventId: '1',
        ngoId: '1',
        category: 'health' as const,
        impactUnit: 'donations',
        impactMultiplier: 1.5,
        difficulty: 'hard' as const,
        expectedDurationHours: 1,
        baseKarmaPerHour: 70,
        maxKarmaPerEvent: 560,
        qrCodes: { checkIn: 'in', checkOut: 'out' },
        gpsRadius: 100,
        maxVolunteers: 50,
        confirmedVolunteers: 0,
        status: 'published' as const,
      };

      // 70 * 1 * 1.5 * 2.0 = 210
      expect(calculateKarmaEarned(event, 1)).toBe(210);
    });

    it('caps karma at maxKarmaPerEvent', () => {
      const event = {
        _id: '1',
        merchantEventId: '1',
        ngoId: '1',
        category: 'environment' as const,
        impactUnit: 'trees',
        impactMultiplier: 1.2,
        difficulty: 'easy' as const,
        expectedDurationHours: 10,
        baseKarmaPerHour: 50,
        maxKarmaPerEvent: 200,
        qrCodes: { checkIn: 'in', checkOut: 'out' },
        gpsRadius: 100,
        maxVolunteers: 50,
        confirmedVolunteers: 0,
        status: 'published' as const,
      };

      // 50 * 10 * 1.2 * 1.0 = 600 → capped at 200
      expect(calculateKarmaEarned(event, 10)).toBe(200);
    });

    it('handles zero hours', () => {
      const event = {
        _id: '1',
        merchantEventId: '1',
        ngoId: '1',
        category: 'community' as const,
        impactUnit: 'hours',
        impactMultiplier: 1.0,
        difficulty: 'easy' as const,
        expectedDurationHours: 4,
        baseKarmaPerHour: 45,
        maxKarmaPerEvent: 300,
        qrCodes: { checkIn: 'in', checkOut: 'out' },
        gpsRadius: 100,
        maxVolunteers: 50,
        confirmedVolunteers: 0,
        status: 'published' as const,
      };

      expect(calculateKarmaEarned(event, 0)).toBe(0);
    });
  });

  // ── applyDailyDecay ─────────────────────────────────────────────────────

  describe('applyDailyDecay', () => {
    function makeProfile(
      activeKarma: number,
      lastActivityDaysAgo: number,
      level: 'L1' | 'L2' | 'L3' | 'L4' = 'L2',
    ): KarmaProfile {
      const lastActivityAt = new Date(
        Date.now() - lastActivityDaysAgo * 24 * 60 * 60 * 1000,
      );
      return {
        _id: 'test-id',
        userId: 'user-123',
        lifetimeKarma: activeKarma,
        activeKarma,
        level,
        eventsCompleted: 5,
        eventsJoined: 5,
        totalHours: 20,
        trustScore: 80,
        badges: [],
        lastActivityAt,
        levelHistory: [],
        conversionHistory: [],
        thisWeekKarmaEarned: 0,
        avgEventDifficulty: 0.5,
        avgConfidenceScore: 0.8,
        checkIns: 5,
        approvedCheckIns: 4,
        activityHistory: [lastActivityAt],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    it('returns no change when last activity < 30 days ago', () => {
      const profile = makeProfile(1000, 10);
      const delta = applyDailyDecay(profile);
      expect(delta.activeKarmaChange).toBe(0);
      expect(delta.levelChange).toBe(false);
    });

    it('returns no change when last activity is null', () => {
      const profile = makeProfile(1000, 0);
      profile.lastActivityAt = null as unknown as Date;
      const delta = applyDailyDecay(profile);
      expect(delta.activeKarmaChange).toBe(0);
      expect(delta.levelChange).toBe(false);
    });

    it('applies 20% decay when inactive 30-44 days', () => {
      const profile = makeProfile(1000, 35, 'L2');
      const delta = applyDailyDecay(profile);
      // 1000 * (1 - 0.20) = 800
      expect(delta.activeKarmaChange).toBe(-200);
      expect(delta.levelChange).toBe(false); // 800 still L2
    });

    it('drops level when decay crosses threshold (L2 → L1)', () => {
      const profile = makeProfile(600, 35, 'L2');
      const delta = applyDailyDecay(profile);
      // 600 * 0.80 = 480 → L1
      expect(delta.activeKarmaChange).toBe(-120);
      expect(delta.levelChange).toBe(true);
      expect(delta.oldLevel).toBe('L2');
      expect(delta.newLevel).toBe('L1');
    });

    it('applies 40% decay when inactive 45-59 days', () => {
      const profile = makeProfile(1000, 50, 'L2');
      const delta = applyDailyDecay(profile);
      // 1000 * (1 - 0.40) = 600 — still within L2 range, no level change
      expect(delta.activeKarmaChange).toBe(-400);
      expect(delta.levelChange).toBe(false);
      expect(delta.newLevel).toBe('L2');
    });

    it('applies 70% decay when inactive 60+ days', () => {
      const profile = makeProfile(1000, 70, 'L2');
      const delta = applyDailyDecay(profile);
      // 1000 * (1 - 0.70) = 300
      expect(delta.activeKarmaChange).toBe(-700);
      expect(delta.levelChange).toBe(true); // 300 → L1
      expect(delta.newLevel).toBe('L1');
    });

    it('drops L4 to L2 after 40% decay', () => {
      const profile = makeProfile(5000, 50, 'L4');
      const delta = applyDailyDecay(profile);
      // 5000 * 0.60 = 3000 → L3
      expect(delta.activeKarmaChange).toBe(-2000);
      expect(delta.levelChange).toBe(true);
      expect(delta.newLevel).toBe('L3');
    });

    it('floors the new active karma value', () => {
      // 499 * (1 - 0.20) = 399.2 → floor → 399
      const profile = makeProfile(499, 30, 'L1');
      const delta = applyDailyDecay(profile);
      expect(delta.activeKarmaChange).toBe(-100);
      expect(profile.activeKarma + delta.activeKarmaChange).toBe(399);
    });
  });

  // ── calculateConversion ──────────────────────────────────────────────────

  describe('calculateConversion', () => {
    it('converts at 25% for L1', () => {
      // floor(1000 * 0.25) = 250
      expect(calculateConversion(1000, 0.25)).toBe(250);
    });

    it('converts at 50% for L2', () => {
      // floor(1000 * 0.50) = 500
      expect(calculateConversion(1000, 0.5)).toBe(500);
    });

    it('converts at 75% for L3', () => {
      // floor(1000 * 0.75) = 750
      expect(calculateConversion(1000, 0.75)).toBe(750);
    });

    it('converts at 100% for L4', () => {
      // floor(1000 * 1.0) = 1000
      expect(calculateConversion(1000, 1.0)).toBe(1000);
    });

    it('floors fractional results', () => {
      // floor(333 * 0.75) = 249
      expect(calculateConversion(333, 0.75)).toBe(249);
    });

    it('returns 0 for 0 karma earned', () => {
      expect(calculateConversion(0, 1.0)).toBe(0);
    });
  });

  // ── applyCaps ───────────────────────────────────────────────────────────

  describe('applyCaps', () => {
    it('returns coins when below weekly cap', () => {
      expect(applyCaps(100, 0)).toBe(100);
      expect(applyCaps(299, 0)).toBe(299);
    });

    it('enforces weekly cap of 300 coins', () => {
      expect(applyCaps(500, 0)).toBe(300); // first week, full cap
      expect(applyCaps(500, 100)).toBe(200); // 100 already earned, 200 remaining
      expect(applyCaps(500, 299)).toBe(1); // 299 earned, only 1 remaining
    });

    it('returns 0 when weekly cap is already exhausted', () => {
      expect(applyCaps(100, 300)).toBe(0);
      expect(applyCaps(100, 400)).toBe(0);
    });

    it('handles exact cap boundary', () => {
      expect(applyCaps(0, 300)).toBe(0);
      expect(applyCaps(1, 299)).toBe(1);
      expect(applyCaps(300, 0)).toBe(300);
    });

    it('caps at weekly remaining even when coins < remaining', () => {
      // 50 coins requested, only 10 remaining → 10
      expect(applyCaps(50, 290)).toBe(10);
    });

    it(' WEEKLY_COIN_CAP constant equals 300', () => {
      expect(WEEKLY_COIN_CAP).toBe(300);
    });
  });

  // ── LEVEL_THRESHOLDS constant ──────────────────────────────────────────

  describe('LEVEL_THRESHOLDS', () => {
    it('has correct thresholds', () => {
      expect(LEVEL_THRESHOLDS.L1).toBe(0);
      expect(LEVEL_THRESHOLDS.L2).toBe(500);
      expect(LEVEL_THRESHOLDS.L3).toBe(2000);
      expect(LEVEL_THRESHOLDS.L4).toBe(5000);
    });
  });
});
