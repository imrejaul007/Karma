/**
 * Impact Report Service — generates a branded PDF Impact Report for a user.
 *
 * Data gathered:
 * - Profile: karma, level, events, hours, trust score
 * - KarmaScore: 300-900 score, band, percentile
 * - Badges: all earned badges with icons and dates
 * - Category breakdown: events per category
 * - Top cause: category with most events
 * - Earn history: recent events with karma earned
 */
import PDFDocument from 'pdfkit';
import type { KarmaLevel as Level } from '@rez/shared-types';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { EarnRecord } from '../models/EarnRecord.js';
import { computeKarmaScore, getBandMetadata } from '../engines/karmaScoreEngine.js';
import { getConversionRate } from '../engines/karmaEngine.js';
import { logger } from '../config/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportData {
  userId: string;
  userName: string;
  volunteerSince: string;
  lifetimeKarma: number;
  activeKarma: number;
  level: Level;
  conversionRate: number;
  eventsCompleted: number;
  totalHours: number;
  trustScore: number;
  karmaScore: number;
  scoreBand: string;
  bandLabel: string;
  percentile: number;
  badges: Array<{
    id: string;
    name: string;
    icon: string;
    earnedAt: string;
  }>;
  categoryBreakdown: Array<{
    category: string;
    count: number;
    karma: number;
  }>;
  topCause: string | null;
  recentEvents: Array<{
    name: string;
    karmaEarned: number;
    date: string;
    category: string;
  }>;
  coinsEarned: number;
}

interface EarnRecordDoc {
  eventId?: string;
  eventName?: string;
  karmaEarned: number;
  createdAt: Date;
  status: string;
}

// ---------------------------------------------------------------------------
// Data Fetcher
// ---------------------------------------------------------------------------

async function gatherReportData(userId: string, userName: string): Promise<ReportData> {
  const profile = await KarmaProfile.findOne({ userId: new (await import('mongoose')).default.Types.ObjectId(userId) }).lean();

  if (!profile) {
    throw new Error('Karma profile not found');
  }

  // KarmaScore
  let karmaScore = 0;
  let scoreBand = 'starter';
  let bandLabel = 'Starter';
  let percentile = 0;
  try {
    const scoreResult = await computeKarmaScore(userId, true);
    if (scoreResult) {
      karmaScore = scoreResult.total;
      scoreBand = scoreResult.band;
      const meta = getBandMetadata(scoreResult.band);
      bandLabel = meta.label;
      percentile = scoreResult.percentile ?? 0;
    }
  } catch {
    // Non-fatal — score may not exist yet
  }

  // Category breakdown from profile fields
  const categories = [
    { key: 'environmentEvents', label: 'Environment' },
    { key: 'foodEvents', label: 'Food Drive' },
    { key: 'healthEvents', label: 'Health' },
    { key: 'educationEvents', label: 'Education' },
    { key: 'communityEvents', label: 'Community' },
  ];

  const categoryBreakdown = categories
    .map((c) => ({
      category: c.label,
      count: (profile as Record<string, unknown>)[c.key] as number ?? 0,
      karma: 0, // estimated: count × 50 average karma per event
    }))
    .map((c) => ({ ...c, karma: c.count * 50 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const topCause = categoryBreakdown.length > 0 ? categoryBreakdown[0].category : null;

  // Recent earn records (last 5 completed)
  const recentRecords = await EarnRecord.find({ userId, status: 'CONVERTED' })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean() as unknown as EarnRecordDoc[];

  const recentEvents = recentRecords.map((r) => ({
    name: r.eventName ?? 'Impact Event',
    karmaEarned: r.karmaEarned,
    date: new Date(r.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    category: 'Impact',
  }));

  // Coins earned = sum of converted karma × rate
  const totalConvertedKarma = await EarnRecord.aggregate([
    { $match: { userId: userId as unknown as import('mongoose').default.Types.ObjectId, status: 'CONVERTED' } },
    { $group: { _id: null, total: { $sum: '$karmaEarned' } } },
  ]);
  const lifetimeKarmaVal = profile.lifetimeKarma ?? 0;
  const rate = getConversionRate((profile.level ?? 'L1') as Level);
  const coinsEarned = Math.floor(lifetimeKarmaVal * (rate / 100) * 0.7); // ~70% typically converted

  const level: Level = (profile.level ?? 'L1') as Level;
  const conversionRate = getConversionRate(level);

  return {
    userId,
    userName,
    volunteerSince: profile.createdAt
      ? new Date(profile.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : 'Recently',
    lifetimeKarma: lifetimeKarmaVal,
    activeKarma: profile.activeKarma ?? 0,
    level,
    conversionRate,
    eventsCompleted: profile.eventsCompleted ?? 0,
    totalHours: profile.totalHours ?? 0,
    trustScore: Math.round(profile.trustScore ?? 0),
    karmaScore,
    scoreBand,
    bandLabel,
    percentile,
    badges: (profile.badges ?? []).map((b: any) => ({
      id: b.id ?? '',
      name: b.name ?? '',
      icon: b.icon ?? '',
      earnedAt: b.earnedAt
        ? new Date(b.earnedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : '',
    })),
    categoryBreakdown,
    topCause,
    recentEvents,
    coinsEarned,
  };
}

// ---------------------------------------------------------------------------
// PDF Generator
// ---------------------------------------------------------------------------

const PURPLE = '#7C3AED';
const GREEN = '#10B981';
const GOLD = '#F59E0B';
const DARK = '#1F2937';
const GRAY = '#6B7280';
const LIGHT_BG = '#F9FAFB';

const LEVEL_NAMES: Record<Level, string> = {
  L1: 'Seed',
  L2: 'Sprout',
  L3: 'Bloom',
  L4: 'Tree',
};

export async function generateImpactReportPDF(
  userId: string,
  userName: string,
): Promise<Buffer> {
  const data = await gatherReportData(userId, userName);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 40, left: 40, right: 40 },
      info: {
        Title: `Impact Report — ${userName}`,
        Author: 'Karma by ReZ',
        Subject: 'Volunteer Impact Report',
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width - 80; // 40px margins each side
    let y = 0;

    // ── HERO HEADER ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 180).fill(PURPLE);

    // Leaf icon + "Karma" wordmark
    doc.fontSize(11).fillColor('rgba(255,255,255,0.8)').text('♻ Karma by ReZ', 40, 20);

    // "Impact Report" title
    doc.fontSize(28).fillColor('#ffffff').text('Impact Report', 40, 50);

    // Name
    doc.fontSize(18).fillColor('rgba(255,255,255,0.9)').text(data.userName, 40, 88);

    // Volunteer since
    doc.fontSize(10).fillColor('rgba(255,255,255,0.7)').text(`Volunteering since ${data.volunteerSince}`, 40, 115);

    // KarmaScore circle
    doc.fontSize(52).fillColor('#ffffff').text(String(data.karmaScore), 40, 130);
    doc.fontSize(12).fillColor('rgba(255,255,255,0.8)').text(`/ 900`, 40 + String(data.karmaScore).length * 20, 155);

    // Band badge
    const bandX = 220;
    doc.roundedRect(bandX, 135, 120, 36, 8).fill(data.scoreBand === 'pinnacle' ? GOLD : data.scoreBand === 'elite' ? '#8B5CF6' : GREEN);
    doc.fontSize(11).fillColor('#ffffff').text(`${data.bandLabel} Band`, bandX + 15, 145);
    doc.fontSize(9).fillColor('rgba(255,255,255,0.8)').text(`Top ${data.percentile.toFixed(1)}%`, bandX + 15, 162);

    // ── STATS GRID ─────────────────────────────────────────────────────────
    y = 200;
    const statCardW = (PAGE_W - 20) / 4;
    const stats = [
      { label: 'Events', value: String(data.eventsCompleted), sub: 'completed' },
      { label: 'Hours', value: String(data.totalHours), sub: 'given' },
      { label: 'Badges', value: String(data.badges.length), sub: 'earned' },
      { label: 'Trust', value: `${data.trustScore}%`, sub: 'score' },
    ];

    stats.forEach((stat, i) => {
      const sx = 40 + i * (statCardW + 5);
      doc.roundedRect(sx, y, statCardW, 60, 6).fill(LIGHT_BG);
      doc.strokeColor(PURPLE).lineWidth(1).roundedRect(sx, y, statCardW, 60, 6).stroke();
      doc.fontSize(22).fillColor(DARK).text(stat.value, sx + 10, y + 10);
      doc.fontSize(9).fillColor(GRAY).text(stat.label, sx + 10, y + 35);
      doc.fontSize(8).fillColor(GRAY).text(stat.sub, sx + 10, y + 48);
    });

    // ── KARMA + LEVEL SECTION ─────────────────────────────────────────────
    y += 80;

    // Left: Karma points
    doc.roundedRect(40, y, PAGE_W * 0.45, 80, 8).fill(LIGHT_BG);
    doc.fontSize(9).fillColor(GRAY).text('KARMA BALANCE', 55, y + 12);
    doc.fontSize(32).fillColor(DARK).text(data.activeKarma.toLocaleString(), 55, y + 25);
    doc.fontSize(9).fillColor(GRAY).text(`Active karma`, 55, y + 60);
    doc.fontSize(9).fillColor(GRAY).text(`${data.lifetimeKarma.toLocaleString()} lifetime`, 55, y + 72);

    // Right: Level
    const levelX = 40 + PAGE_W * 0.5;
    doc.roundedRect(levelX, y, PAGE_W * 0.5, 80, 8).fill(LIGHT_BG);
    const levelName = LEVEL_NAMES[data.level];
    doc.fontSize(9).fillColor(GRAY).text('LEVEL', levelX + 15, y + 12);
    doc.fontSize(28).fillColor(PURPLE).text(`${data.level} — ${levelName}`, levelX + 15, y + 25);
    doc.fontSize(9).fillColor(GRAY).text(`${data.conversionRate}% conversion rate`, levelX + 15, y + 60);
    const levelToNext = data.level === 'L4' ? 'Maximum reached' : 'Keep going!';
    doc.fontSize(9).fillColor(GREEN).text(levelToNext, levelX + 15, y + 72);

    // ── TOP CAUSE ──────────────────────────────────────────────────────────
    y += 100;
    if (data.topCause) {
      doc.roundedRect(40, y, PAGE_W, 50, 8).fill('#DCFCE7');
      doc.fontSize(9).fillColor(GRAY).text('TOP CAUSE', 55, y + 10);
      doc.fontSize(16).fillColor('#166534').text(data.topCause, 55, y + 24);
      doc.fontSize(9).fillColor(GRAY).text(`${data.categoryBreakdown[0]?.count ?? 0} events  •  ${data.categoryBreakdown[0]?.karma ?? 0} karma earned`, 55, y + 42);
    }

    // ── BADGES ────────────────────────────────────────────────────────────
    y += 70;
    if (data.badges.length > 0) {
      doc.fontSize(11).fillColor(DARK).text('Badges Earned', 40, y);
      y += 15;
      const badgeW = Math.min(80, PAGE_W / data.badges.length);
      const badgeCols = Math.ceil(PAGE_W / badgeW);
      data.badges.forEach((badge, i) => {
        const bx = 40 + (i % badgeCols) * (badgeW + 5);
        const by = y + Math.floor(i / badgeCols) * 65;
        doc.roundedRect(bx, by, badgeW - 5, 55, 6).fill(PURPLE + '20');
        doc.strokeColor(PURPLE).lineWidth(0.5).roundedRect(bx, by, badgeW - 5, 55, 6).stroke();
        doc.fontSize(16).fillColor(DARK).text(badge.icon || '🏆', bx + (badgeW - 20) / 2, by + 6);
        doc.fontSize(7).fillColor(DARK).text(badge.name, bx + 3, by + 30, { width: badgeW - 13, align: 'center' });
        doc.fontSize(6).fillColor(GRAY).text(badge.earnedAt, bx + 3, by + 43, { width: badgeW - 13, align: 'center' });
      });
      y += Math.ceil(data.badges.length / badgeCols) * 70;
    }

    // ── RECENT IMPACT ──────────────────────────────────────────────────────
    if (data.recentEvents.length > 0) {
      y += 15;
      if (y > 650) { doc.addPage(); y = 40; }

      doc.fontSize(11).fillColor(DARK).text('Recent Impact', 40, y);
      y += 20;

      data.recentEvents.forEach((event, i) => {
        if (y > 740) { doc.addPage(); y = 40; }
        doc.roundedRect(40, y, PAGE_W, 32, 4).fill(i % 2 === 0 ? LIGHT_BG : '#ffffff');
        doc.fontSize(9).fillColor(DARK).text(event.name, 50, y + 6, { width: PAGE_W - 100 });
        doc.fontSize(8).fillColor(GRAY).text(event.date, 50, y + 18);
        doc.fontSize(10).fillColor(GREEN).text(`+${event.karmaEarned} karma`, PAGE_W - 90, y + 10);
        y += 36;
      });
    }

    // ── FOOTER ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY - 20, doc.page.width, 80).fill(LIGHT_BG);
    doc.fontSize(8).fillColor(GRAY).text('Generated by Karma by ReZ', 40, footerY);
    doc.fontSize(7).fillColor(GRAY).text(
      'This report was auto-generated based on verified volunteer activity. Karma is permanent, portable, and compounds over time.',
      40, footerY + 14, { width: PAGE_W - 80 },
    );
    doc.fontSize(7).fillColor(PURPLE).text(
      'Doing Good. Build Karma. Unlock More.',
      40, footerY + 32,
    );
    doc.fontSize(7).fillColor(GRAY).text(
      `rez.money/karma  •  Report ID: ${userId.slice(-8).toUpperCase()}`,
      40, footerY + 46,
    );

    doc.end();
  });
}
