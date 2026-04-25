/**
 * Impact Resume PDF Template
 *
 * Professional two-column A4 layout designed for:
 * - LinkedIn sharing
 * - College applications
 * - CSR reporting
 * - Job resumes
 *
 * Layout:
 * - Header: "Impact Resume" + user name + karma score + generated date
 * - LEFT column: summary metrics, journey timeline, impact by category
 * - RIGHT column: badges grid, top events, skills tags, achievements
 * - Footer: "Verified by Karma by ReZ • rez.money/karma"
 */
import PDFDocument from 'pdfkit';
import type { ImpactResume } from '../services/impactResumeService.js';

// ---------------------------------------------------------------------------
// Color Palette
// ---------------------------------------------------------------------------

const PURPLE = '#7C3AED';
const PURPLE_LIGHT = '#EDE9FE';
const GREEN = '#10B981';
const GREEN_LIGHT = '#D1FAE5';
const GOLD = '#F59E0B';
const GOLD_LIGHT = '#FEF3C7';
const DARK = '#1F2937';
const GRAY = '#6B7280';
const LIGHT_BG = '#F9FAFB';
const WHITE = '#FFFFFF';
const BORDER = '#E5E7EB';

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function wrapText(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  fontSize: number,
): string {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = doc.widthOfString(testLine);

    if (testWidth > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) lines.push(line);
  return lines.join('\n');
}

function drawSectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  x: number,
  y: number,
): number {
  doc.fontSize(10).fillColor(PURPLE).text(title.toUpperCase(), x, y, {
    characterSpacing: 1,
  });
  // Underline
  const titleWidth = doc.widthOfString(title.toUpperCase());
  doc
    .strokeColor(PURPLE)
    .lineWidth(1)
    .moveTo(x, y + 14)
    .lineTo(x + titleWidth + 10, y + 14)
    .stroke();
  return y + 22;
}

// ---------------------------------------------------------------------------
// PDF Generator
// ---------------------------------------------------------------------------

export interface ResumePDFOptions {
  userName: string;
}

export async function generateImpactResumePDF(
  resume: ImpactResume,
  options: ResumePDFOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 50, left: 40, right: 40 },
      info: {
        Title: `Impact Resume — ${options.userName}`,
        Author: 'Karma by ReZ',
        Subject: 'Volunteer Impact Resume',
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width - 80;
    const PAGE_H = doc.page.height;
    const COL_W = (PAGE_W - 20) / 2; // Two columns with gap
    const LEFT_X = 40;
    const RIGHT_X = LEFT_X + COL_W + 20;

    let y = 0;

    // ── HERO HEADER ──────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 160).fill(PURPLE);

    // Header label
    doc.fontSize(10).fillColor('rgba(255,255,255,0.8)').text('ReZ Karma', 40, 15);

    // Title
    doc.fontSize(26).fillColor(WHITE).text('Impact Resume', 40, 35);

    // Name
    doc.fontSize(18).fillColor('rgba(255,255,255,0.95)').text(options.userName, 40, 70);

    // Karma metrics row
    doc.fontSize(11).fillColor('rgba(255,255,255,0.7)').text('KarmaScore', 40, 100);
    doc.fontSize(36).fillColor(WHITE).text(String(resume.summary.karmaScore), 40, 112);

    // Right side of header
    const headerRightX = PAGE_W - 150;
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text(`Level ${resume.summary.level}`, headerRightX, 50);
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text(`${resume.summary.percentile.toFixed(1)}th percentile`, headerRightX, 65);
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text(`${resume.summary.trustScore}% trust`, headerRightX, 80);
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text(`${resume.summary.conversionRate}% conversion`, headerRightX, 95);

    // Volunteer since
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text(`Volunteering since ${resume.summary.volunteerSince}`, 40, 130);

    // Generated date
    const generatedDate = new Date(resume.generatedAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    doc
      .fontSize(8)
      .fillColor('rgba(255,255,255,0.5)')
      .text(`Generated: ${generatedDate}`, 40, 145);

    // ── MAIN CONTENT AREA ───────────────────────────────────────────────────
    y = 180;

    // ── LEFT COLUMN ──────────────────────────────────────────────────────

    // Summary Stats Grid
    doc.fontSize(9).fillColor(GRAY).text('SUMMARY', LEFT_X, y);
    y += 18;

    const statsData = [
      { value: resume.summary.eventsCompleted, label: 'Events', sub: 'completed' },
      { value: resume.summary.totalHours, label: 'Hours', sub: 'given' },
      { value: resume.summary.lifetimeKarma, label: 'Lifetime', sub: 'karma' },
      { value: resume.summary.activeKarma, label: 'Active', sub: 'karma' },
    ];

    const statCardW = (COL_W - 15) / 2;
    const statCardH = 55;

    statsData.forEach((stat, i) => {
      const sx = LEFT_X + (i % 2) * (statCardW + 5);
      const sy = y + Math.floor(i / 2) * (statCardH + 5);

      doc.roundedRect(sx, sy, statCardW, statCardH, 4).fill(LIGHT_BG);
      doc.strokeColor(BORDER).lineWidth(0.5).roundedRect(sx, sy, statCardW, statCardH, 4).stroke();

      doc.fontSize(20).fillColor(DARK).text(String(stat.value), sx + 8, sy + 8);
      doc.fontSize(8).fillColor(GRAY).text(stat.label, sx + 8, sy + 32);
      doc.fontSize(7).fillColor(GRAY).text(stat.sub, sx + 8, sy + 42);
    });

    y += Math.ceil(statsData.length / 2) * (statCardH + 5) + 20;

    // Journey Timeline
    y = drawSectionTitle(doc, 'Journey Timeline', LEFT_X, y);

    if (resume.journey.milestones.length > 0) {
      const milestoneStartY = y;

      resume.journey.milestones.forEach((milestone, i) => {
        if (y > 650) { doc.addPage(); y = 50; }

        const lineX = LEFT_X + 10;

        // Timeline dot
        doc.circle(lineX, y + 6, 4).fill(i === 0 ? PURPLE : GRAY);

        // Vertical line (except for last)
        if (i < resume.journey.milestones.length - 1) {
          doc
            .strokeColor(BORDER)
            .lineWidth(1)
            .moveTo(lineX, y + 10)
            .lineTo(lineX, y + 30)
            .stroke();
        }

        // Content
        doc.fontSize(9).fillColor(DARK).text(`Level ${milestone.level}`, LEFT_X + 25, y);
        doc.fontSize(7).fillColor(GRAY).text(milestone.date, LEFT_X + 25, y + 12);

        y += 30;
      });

      y += 10;
    }

    // Impact by Category
    if (resume.impactByCategory.length > 0) {
      y = drawSectionTitle(doc, 'Impact by Category', LEFT_X, y);

      const catBarH = 24;
      const maxBarW = COL_W - 20;

      resume.impactByCategory.forEach((cat, i) => {
        if (y > 720) { doc.addPage(); y = 50; }

        // Category name
        doc.fontSize(8).fillColor(DARK).text(cat.category, LEFT_X, y);

        // Progress bar background
        doc.roundedRect(LEFT_X, y + 12, maxBarW, 8, 2).fill(LIGHT_BG);

        // Progress bar fill
        const fillW = (cat.percentage / 100) * maxBarW;
        if (fillW > 0) {
          doc.roundedRect(LEFT_X, y + 12, fillW, 8, 2).fill(PURPLE);
        }

        // Stats
        doc
          .fontSize(7)
          .fillColor(GRAY)
          .text(`${cat.events} events`, LEFT_X + maxBarW + 5, y + 4);
        doc.fontSize(7).fillColor(GRAY).text(`${cat.hours}h`, LEFT_X + maxBarW + 5, y + 14);

        y += catBarH + 5;
      });
    }

    // ── RIGHT COLUMN ─────────────────────────────────────────────────────

    let rightY = 180;

    // Badges Grid
    if (resume.badges.length > 0) {
      rightY = drawSectionTitle(doc, 'Badges Earned', RIGHT_X, rightY);

      const badgeW = (COL_W - 20) / 3;
      const badgeH = 50;

      resume.badges.forEach((badge, i) => {
        if (rightY > 700) { doc.addPage(); rightY = 50; }

        const bx = RIGHT_X + (i % 3) * (badgeW + 5);
        const by = rightY + Math.floor(i / 3) * (badgeH + 5);

        doc.roundedRect(bx, by, badgeW, badgeH, 4).fill(PURPLE_LIGHT);
        doc
          .fontSize(18)
          .fillColor(DARK)
          .text(badge.icon || '\u{1F3C6}', bx + (badgeW - 18) / 2, by + 5);
        doc
          .fontSize(6)
          .fillColor(DARK)
          .text(wrapText(doc, badge.name, badgeW - 8, 6), bx + 4, by + 28, {
            width: badgeW - 8,
            align: 'center',
          });
      });

      rightY += Math.ceil(resume.badges.length / 3) * (badgeH + 5) + 15;
    }

    // Top Events
    if (resume.topEvents.length > 0) {
      if (rightY > 650) { doc.addPage(); rightY = 50; }

      rightY = drawSectionTitle(doc, 'Top Impact Events', RIGHT_X, rightY);

      resume.topEvents.forEach((event, i) => {
        if (rightY > 740) { doc.addPage(); rightY = 50; }

        const eventH = 35;
        doc.roundedRect(RIGHT_X, rightY, COL_W, eventH, 3).fill(i % 2 === 0 ? LIGHT_BG : WHITE);

        doc.fontSize(8).fillColor(DARK).text(event.name, RIGHT_X + 8, rightY + 5, {
          width: COL_W - 80,
        });
        doc.fontSize(7).fillColor(GRAY).text(event.date, RIGHT_X + 8, rightY + 18);
        doc.fontSize(9).fillColor(GREEN).text(`+${event.karma}`, RIGHT_X + COL_W - 50, rightY + 8);

        rightY += eventH + 3;
      });

      rightY += 10;
    }

    // Skills Tags
    if (resume.skills.length > 0) {
      if (rightY > 720) { doc.addPage(); rightY = 50; }

      rightY = drawSectionTitle(doc, 'Skills', RIGHT_X, rightY);

      let tagX = RIGHT_X;
      let tagY = rightY;
      const tagH = 18;
      const tagPadding = 8;

      for (const skill of resume.skills) {
        const tagW = doc.widthOfString(skill) + tagPadding * 2;

        if (tagX + tagW > RIGHT_X + COL_W) {
          tagX = RIGHT_X;
          tagY += tagH + 4;
        }

        doc.roundedRect(tagX, tagY, tagW, tagH, 9).fill(GREEN_LIGHT);
        doc.fontSize(8).fillColor(DARK).text(skill, tagX + tagPadding, tagY + 4);

        tagX += tagW + 5;
      }

      rightY = tagY + tagH + 15;
    }

    // Achievements
    if (resume.achievements.length > 0) {
      if (rightY > 720) { doc.addPage(); rightY = 50; }

      rightY = drawSectionTitle(doc, 'Achievements', RIGHT_X, rightY);

      resume.achievements.forEach((achievement) => {
        if (rightY > 740) { doc.addPage(); rightY = 50; }

        const achText = wrapText(doc, achievement, COL_W - 20, 8);
        const lines = achText.split('\n').length;
        const achH = Math.max(20, lines * 12 + 8);

        doc.roundedRect(RIGHT_X, rightY, COL_W, achH, 3).fill(GOLD_LIGHT);

        // Star icon
        doc.fontSize(10).fillColor(GOLD).text('★', RIGHT_X + 6, rightY + 5);

        // Achievement text
        doc.fontSize(8).fillColor(DARK).text(achText, RIGHT_X + 20, rightY + 5, {
          width: COL_W - 30,
        });

        rightY += achH + 4;
      });

      rightY += 10;
    }

    // Streak Data
    if (resume.streakData.currentStreak > 0) {
      if (rightY > 740) { doc.addPage(); rightY = 50; }

      rightY = drawSectionTitle(doc, 'Streak', RIGHT_X, rightY);

      doc.roundedRect(RIGHT_X, rightY, COL_W, 40, 4).fill(LIGHT_BG);

      doc.fontSize(16).fillColor(GOLD).text(`\u{1F525} ${resume.streakData.currentStreak}`, RIGHT_X + 10, rightY + 8);
      doc.fontSize(8).fillColor(GRAY).text('Current Streak', RIGHT_X + 60, rightY + 12);

      doc.fontSize(8).fillColor(GRAY).text(`Longest: ${resume.streakData.longestStreak} days`, RIGHT_X + 10, rightY + 28);
    }

    // ── FOOTER ─────────────────────────────────────────────────────────────
    const footerY = PAGE_H - 45;

    doc.rect(0, footerY - 10, doc.page.width, 55).fill(LIGHT_BG);

    doc
      .fontSize(8)
      .fillColor(GRAY)
      .text('Verified by Karma by ReZ', 40, footerY);
    doc
      .fontSize(7)
      .fillColor(GRAY)
      .text(
        'This Impact Resume was auto-generated based on verified volunteer activity. Karma is permanent, portable, and compounds over time.',
        40,
        footerY + 12,
        { width: PAGE_W - 80 },
      );
    doc.fontSize(7).fillColor(PURPLE).text('ReZ.money/Karma', 40, footerY + 26);
    doc
      .fontSize(7)
      .fillColor(GRAY)
      .text(`Resume ID: ${resume.userId.slice(-8).toUpperCase()} | ${generatedDate}`, 40, footerY + 38);

    doc.end();
  });
}
