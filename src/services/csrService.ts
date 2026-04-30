// -nocheck
// @ts-ignore
/**
 * CSR Service — Corporate Social Responsibility Cloud business logic
 *
 * Provides operations for:
 * - Corporate partner dashboard data
 * - CSR report generation
 * - Karma credit allocation
 * - Employee program management
 */
import mongoose from 'mongoose';
import { CorporatePartner, CsrAllocation, KarmaProfile, KarmaEvent, EarnRecord } from '../models/index.js';
import type { CorporatePartnerDocument } from '../models/CorporatePartner.js';
import type { CsrAllocationDocument } from '../models/CsrAllocation.js';
import { logger } from '../config/logger.js';

// ---------------------------------------------------------------------------
// Date Helper Functions (replaces moment.js)
// ---------------------------------------------------------------------------

function getStartOfYear(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthName(month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month];
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function getQuarterStart(year: number, quarter: number): Date {
  // Quarter 1 = Jan 1, Quarter 2 = Apr 1, Quarter 3 = Jul 1, Quarter 4 = Oct 1
  const startMonth = (quarter - 1) * 3;
  return new Date(year, startMonth, 1, 0, 0, 0, 0);
}

function getQuarterEnd(year: number, quarter: number): Date {
  // End is the last day of the last month of the quarter
  const lastMonthOfQuarter = quarter * 3; // 3, 6, 9, or 12
  return new Date(year, lastMonthOfQuarter, 0, 23, 59, 59, 999);
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface TopCause {
  category: string;
  events: number;
  hours: number;
}

export interface MonthlyTrend {
  month: string;
  events: number;
  volunteers: number;
}

export interface EmployeeLeaderboardEntry {
  userId: string;
  karma: number;
  events: number;
  hours: number;
  rank: number;
}

export interface RecentActivity {
  eventName: string;
  date: string;
  volunteers: number;
  karma: number;
}

export interface YtdStats {
  totalEvents: number;
  totalVolunteers: number;
  totalHours: number;
  totalKarma: number;
  activeEmployees: number;
  topCauses: TopCause[];
  monthlyTrend: MonthlyTrend[];
}

export interface CorporateDashboard {
  partner: CorporatePartnerDocument;
  ytdStats: YtdStats;
  employeeLeaderboard: EmployeeLeaderboardEntry[];
  recentActivity: RecentActivity[];
}

export interface ExecutiveSummary {
  totalVolunteers: number;
  totalHours: number;
  totalKarma: number;
  eventsHosted: number;
  carbonOffset: string;
  mealsDonated: number;
  treesPlanted: number;
}

export interface ImpactByCategory {
  category: string;
  percentage: number;
  events: number;
}

export interface TopPerformer {
  name: string;
  karma: number;
  events: number;
}

export interface EmployeeParticipation {
  totalEmployees: number;
  activeEmployees: number;
  participationRate: number;
  topPerformers: TopPerformer[];
}

export interface EventListEntry {
  name: string;
  date: string;
  category: string;
  volunteers: number;
  karma: number;
}

export interface CsrReport {
  companyName: string;
  period: {
    start: string;
    end: string;
  };
  executiveSummary: ExecutiveSummary;
  impactByCategory: ImpactByCategory[];
  employeeParticipation: EmployeeParticipation;
  eventList: EventListEntry[];
}

export interface EmployeeStats {
  userId: string;
  karma: number;
  events: number;
  hours: number;
  rank: number;
  participationRate: number;
}

// ---------------------------------------------------------------------------
// Dashboard Data
// ---------------------------------------------------------------------------

/**
 * Get the corporate dashboard data for a partner
 */
export async function getCorporateDashboard(partnerId: string): Promise<CorporateDashboard> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  const partner = await CorporatePartner.findById(partnerId).lean() as CorporatePartnerDocument | null;
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  // Calculate YTD stats
  const startOfYear = getStartOfYear();
  const now = new Date();

  // Get events sponsored by this partner
  const sponsoredEventIds = partner.sponsoredEvents || [];

  // Get earn records for sponsored events in current year
  const earnRecordsAggregation = await EarnRecord.aggregate([
    {
      $match: {
        eventId: { $in: sponsoredEventIds },
        status: 'APPROVED_PENDING_CONVERSION',
        approvedAt: { $gte: startOfYear },
      },
    },
    {
      $group: {
        _id: null,
        totalVolunteers: { $addToSet: '$userId' },
        totalKarma: { $sum: '$karmaEarned' },
      },
    },
    {
      $project: {
        totalVolunteers: { $size: '$totalVolunteers' },
        totalKarma: 1,
      },
    },
  ]);

  const earnStats = earnRecordsAggregation[0] || { totalVolunteers: 0, totalKarma: 0 };

  // Get karma events stats
  const eventsAggregation = await KarmaEvent.aggregate([
    {
      $match: {
        _id: { $in: sponsoredEventIds },
        status: 'completed',
      },
    },
    {
      $group: {
        _id: '$category',
        eventCount: { $sum: 1 },
        totalVolunteers: { $sum: '$confirmedVolunteers' },
        totalHours: { $sum: { $multiply: ['$expectedDurationHours', '$confirmedVolunteers'] } },
      },
    },
  ]);

  // Build top causes
  const topCauses: TopCause[] = eventsAggregation.map((cat) => ({
    category: cat._id as string,
    events: cat.eventCount,
    hours: Math.round(cat.totalHours),
  }));

  // Calculate monthly trend
  const monthlyTrend: MonthlyTrend[] = [];
  for (let month = 0; month < 12; month++) {
    const tempDate = new Date(now.getFullYear(), month, 1);
    const monthStart = getMonthStart(tempDate);
    const monthEnd = getMonthEnd(tempDate);

    if (monthStart > now) break;

    const monthEvents = await KarmaEvent.countDocuments({
      _id: { $in: sponsoredEventIds },
      status: 'completed',
      createdAt: { $gte: monthStart, $lte: monthEnd },
    });

    const monthVolunteers = await EarnRecord.aggregate([
      {
        $match: {
          eventId: { $in: sponsoredEventIds },
          status: 'APPROVED_PENDING_CONVERSION',
          approvedAt: { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: { _id: null, count: { $addToSet: '$userId' } },
      },
      { $project: { count: { $size: '$count' } } },
    ]);

    monthlyTrend.push({
      month: getMonthName(month),
      events: monthEvents,
      volunteers: monthVolunteers[0]?.count || 0,
    });
  }

  // Calculate total hours
  const totalHoursResult = await KarmaEvent.aggregate([
    { $match: { _id: { $in: sponsoredEventIds }, status: 'completed' } },
    { $group: { _id: null, totalHours: { $sum: { $multiply: ['$expectedDurationHours', '$confirmedVolunteers'] } } } },
  ]);
  const totalHours = totalHoursResult[0]?.totalHours || 0;

  // Employee leaderboard
  const employeeLeaderboard = await buildEmployeeLeaderboard(partner);

  // Recent activity
  const recentActivity = await buildRecentActivity(sponsoredEventIds);

  // Active employees count
  const activeEmployees = await EarnRecord.aggregate([
    {
      $match: {
        eventId: { $in: sponsoredEventIds },
        status: 'APPROVED_PENDING_CONVERSION',
        approvedAt: { $gte: startOfYear },
      },
    },
    {
      $group: { _id: '$userId' },
    },
    {
      $count: 'activeEmployees',
    },
  ]);

  const ytdStats: YtdStats = {
    totalEvents: partner.stats?.totalEvents || eventsAggregation.reduce((sum, e) => sum + e.eventCount, 0),
    totalVolunteers: earnStats.totalVolunteers,
    totalHours: Math.round(totalHours),
    totalKarma: earnStats.totalKarma,
    activeEmployees: activeEmployees[0]?.activeEmployees || 0,
    topCauses,
    monthlyTrend,
  };

  return {
    partner: partner as unknown as CorporatePartnerDocument,
    ytdStats,
    employeeLeaderboard,
    recentActivity,
  };
}

/**
 * Build employee leaderboard for a corporate partner
 */
async function buildEmployeeLeaderboard(
  partner: CorporatePartnerDocument,
): Promise<EmployeeLeaderboardEntry[]> {
  const employeeIds = partner.employeeIds || [];

  if (employeeIds.length === 0) {
    return [];
  }

  const profiles = await KarmaProfile.find({ userId: { $in: employeeIds } })
    .sort({ lifetimeKarma: -1 })
    .limit(50)
    .lean();

  return profiles.map((profile, index) => ({
    userId: (profile.userId as mongoose.Types.ObjectId).toString(),
    karma: profile.lifetimeKarma,
    events: profile.eventsCompleted,
    hours: Math.round(profile.totalHours),
    rank: index + 1,
  }));
}

/**
 * Build recent activity list for sponsored events
 */
async function buildRecentActivity(
  sponsoredEventIds: mongoose.Types.ObjectId[],
): Promise<RecentActivity[]> {
  if (sponsoredEventIds.length === 0) {
    return [];
  }

  const events = await KarmaEvent.find({ _id: { $in: sponsoredEventIds } })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  const recentActivity: RecentActivity[] = [];

  for (const event of events) {
    const earnRecords = await EarnRecord.aggregate([
      {
        $match: {
          eventId: event._id,
          status: 'APPROVED_PENDING_CONVERSION',
        },
      },
      {
        $group: {
          _id: null,
          volunteerCount: { $sum: 1 },
          totalKarma: { $sum: '$karmaEarned' },
        },
      },
    ]);

    recentActivity.push({
      eventName: `${event.category} Event`,
      date: formatDate(event.updatedAt),
      volunteers: earnRecords[0]?.volunteerCount || 0,
      karma: earnRecords[0]?.totalKarma || 0,
    });
  }

  return recentActivity;
}

// ---------------------------------------------------------------------------
// CSR Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a CSR report for a corporate partner
 */
export async function generateCsrReport(
  partnerId: string,
  year: number,
  quarter: number,
): Promise<CsrReport> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  if (quarter < 1 || quarter > 4) {
    throw new Error(`Invalid quarter: ${quarter}. Must be 1-4.`);
  }

  const partner = await CorporatePartner.findById(partnerId).lean() as CorporatePartnerDocument | null;
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  // Calculate period boundaries
  const periodStart = getQuarterStart(year, quarter);
  const periodEnd = getQuarterEnd(year, quarter);

  const sponsoredEventIds = partner.sponsoredEvents || [];

  // Get executive summary stats
  const summaryStats = await EarnRecord.aggregate([
    {
      $match: {
        eventId: { $in: sponsoredEventIds },
        status: 'APPROVED_PENDING_CONVERSION',
        approvedAt: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      $group: {
        _id: null,
        totalVolunteers: { $addToSet: '$userId' },
        totalKarma: { $sum: '$karmaEarned' },
      },
    },
    {
      $project: {
        totalVolunteers: { $size: '$totalVolunteers' },
        totalKarma: 1,
      },
    },
  ]);

  const totalVolunteers = summaryStats[0]?.totalVolunteers || 0;
  const totalKarma = summaryStats[0]?.totalKarma || 0;

  // Get event counts and hours
  const eventStats = await KarmaEvent.aggregate([
    {
      $match: {
        _id: { $in: sponsoredEventIds },
        status: 'completed',
        updatedAt: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        totalHours: { $sum: { $multiply: ['$expectedDurationHours', '$confirmedVolunteers'] } },
        byCategory: { $push: { category: '$category' } },
      },
    },
  ]);

  const totalHours = eventStats[0]?.totalHours || 0;
  const eventsHosted = eventStats[0]?.totalEvents || 0;

  // Calculate estimated impact metrics
  const carbonOffset = (totalHours * 0.5).toFixed(1); // 0.5kg CO2 per volunteer hour
  const mealsDonated = Math.floor(totalHours * 2); // 2 meals per volunteer hour
  const treesPlanted = Math.floor(totalVolunteers / 10); // 1 tree per 10 volunteers

  // Impact by category
  const categoryAggregation = await KarmaEvent.aggregate([
    {
      $match: {
        _id: { $in: sponsoredEventIds },
        status: 'completed',
        updatedAt: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      $group: {
        _id: '$category',
        events: { $sum: 1 },
      },
    },
  ]);

  const totalCategoryEvents = categoryAggregation.reduce((sum, c) => sum + c.events, 0);
  const impactByCategory: ImpactByCategory[] = categoryAggregation.map((cat) => ({
    category: cat._id as string,
    percentage: totalCategoryEvents > 0 ? Math.round((cat.events / totalCategoryEvents) * 100) : 0,
    events: cat.events,
  }));

  // Employee participation
  const employeeIds = partner.employeeIds || [];
  const employeeIdsSet = new Set(employeeIds.map((id) => id.toString()));

  const employeeEarnRecords = await EarnRecord.aggregate([
    {
      $match: {
        eventId: { $in: sponsoredEventIds },
        status: 'APPROVED_PENDING_CONVERSION',
        approvedAt: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      $group: {
        _id: '$userId',
        karma: { $sum: '$karmaEarned' },
        events: { $sum: 1 },
      },
    },
    {
      $sort: { karma: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  const activeEmployeesSet = new Set(employeeEarnRecords.map((e) => e._id.toString()));
  const activeEmployeeCount = employeeEarnRecords.length;

  const topPerformers: TopPerformer[] = employeeEarnRecords.slice(0, 5).map((emp) => ({
    name: `Employee ${emp._id.toString().slice(-4)}`,
    karma: emp.karma,
    events: emp.events,
  }));

  const employeeParticipation: EmployeeParticipation = {
    totalEmployees: employeeIds.length,
    activeEmployees: activeEmployeeCount,
    participationRate: employeeIds.length > 0 ? Math.round((activeEmployeeCount / employeeIds.length) * 100) : 0,
    topPerformers,
  };

  // Event list
  const events = await KarmaEvent.find({ _id: { $in: sponsoredEventIds } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  const eventList: EventListEntry[] = [];

  for (const event of events) {
    if (event.updatedAt < periodStart || event.updatedAt > periodEnd) continue;

    const eventEarnRecords = await EarnRecord.aggregate([
      {
        $match: {
          eventId: event._id,
          status: 'APPROVED_PENDING_CONVERSION',
          approvedAt: { $gte: periodStart, $lte: periodEnd },
        },
      },
      {
        $group: {
          _id: null,
          volunteerCount: { $sum: 1 },
          totalKarma: { $sum: '$karmaEarned' },
        },
      },
    ]);

    eventList.push({
      name: `${event.category.charAt(0).toUpperCase() + event.category.slice(1)} Event`,
      date: formatDate(event.updatedAt),
      category: event.category,
      volunteers: eventEarnRecords[0]?.volunteerCount || 0,
      karma: eventEarnRecords[0]?.totalKarma || 0,
    });
  }

  return {
    companyName: partner.companyName,
    period: {
      start: formatDate(periodStart),
      end: formatDate(periodEnd),
    },
    executiveSummary: {
      totalVolunteers,
      totalHours: Math.round(totalHours),
      totalKarma,
      eventsHosted,
      carbonOffset,
      mealsDonated,
      treesPlanted,
    },
    impactByCategory,
    employeeParticipation,
    eventList,
  };
}

// ---------------------------------------------------------------------------
// Karma Credit Allocation
// ---------------------------------------------------------------------------

/**
 * Allocate karma credits from a corporate partner to a user
 */
export async function allocateKarmaCredits(
  partnerId: string,
  recipientUserId: string,
  amount: number,
  eventId?: string,
): Promise<CsrAllocationDocument> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  if (!mongoose.Types.ObjectId.isValid(recipientUserId)) {
    throw new Error(`Invalid recipientUserId: ${recipientUserId}`);
  }

  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}. Must be a positive number.`);
  }

  // Validate partner exists and has sufficient credits
  const partner = await CorporatePartner.findById(partnerId);
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  const availableCredits = partner.creditsBudget - partner.creditsUsed;
  if (amount > availableCredits) {
    throw new Error(`Insufficient credits. Available: ${availableCredits}, Requested: ${amount}`);
  }

  // Validate eventId if provided
  let validEventId: mongoose.Types.ObjectId;
  if (eventId) {
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new Error(`Invalid eventId: ${eventId}`);
    }
    validEventId = new mongoose.Types.ObjectId(eventId);

    // Verify event is sponsored by this partner
    const event = await KarmaEvent.findById(validEventId);
    if (!event) {
      throw new Error(`Karma event not found: ${eventId}`);
    }
    const isSponsored = partner.sponsoredEvents.some(
      (e) => e.toString() === validEventId.toString(),
    );
    if (!isSponsored) {
      throw new Error(`Event ${eventId} is not sponsored by this partner`);
    }
  } else {
    validEventId = new mongoose.Types.ObjectId();
  }

  // Create allocation record
  const allocation = new CsrAllocation({
    corporatePartnerId: new mongoose.Types.ObjectId(partnerId),
    eventId: validEventId,
    recipientUserId: new mongoose.Types.ObjectId(recipientUserId),
    amount,
    allocatedBy: 'system',
    allocatedAt: new Date(),
    status: 'approved',
  });

  await allocation.save();

  // Update partner's used credits
  await CorporatePartner.findByIdAndUpdate(partnerId, {
    $inc: { creditsUsed: amount },
  });

  logger.info(`Karma credits allocated: ${amount} from partner ${partnerId} to user ${recipientUserId}`);

  return allocation;
}

// ---------------------------------------------------------------------------
// Employee Program Management
// ---------------------------------------------------------------------------

/**
 * Add an employee to a corporate partner's program
 */
export async function addEmployeeToProgram(
  partnerId: string,
  employeeUserId: string,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  if (!mongoose.Types.ObjectId.isValid(employeeUserId)) {
    throw new Error(`Invalid employeeUserId: ${employeeUserId}`);
  }

  const partner = await CorporatePartner.findById(partnerId);
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  const employeeObjectId = new mongoose.Types.ObjectId(employeeUserId);

  // Check if employee already in program
  const alreadyAdded = partner.employeeIds.some(
    (e) => e.toString() === employeeObjectId.toString(),
  );

  if (alreadyAdded) {
    logger.warn(`Employee ${employeeUserId} already in program for partner ${partnerId}`);
    return;
  }

  // Add employee to program
  await CorporatePartner.findByIdAndUpdate(partnerId, {
    $push: { employeeIds: employeeObjectId },
  });

  logger.info(`Employee ${employeeUserId} added to partner ${partnerId} program`);
}

/**
 * Get statistics for a specific employee within a corporate partner's program
 */
export async function getEmployeeStats(
  partnerId: string,
  employeeUserId: string,
): Promise<EmployeeStats> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  if (!mongoose.Types.ObjectId.isValid(employeeUserId)) {
    throw new Error(`Invalid employeeUserId: ${employeeUserId}`);
  }

  const partner = await CorporatePartner.findById(partnerId).lean() as CorporatePartnerDocument | null;
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  // Verify employee is in program
  const employeeObjectId = new mongoose.Types.ObjectId(employeeUserId);
  const isInProgram = partner.employeeIds.some(
    (e) => e.toString() === employeeObjectId.toString(),
  );

  if (!isInProgram) {
    throw new Error(`Employee ${employeeUserId} is not in partner ${partnerId}'s program`);
  }

  // Get employee's karma profile
  const profile = await KarmaProfile.findOne({ userId: employeeObjectId }).lean();
  if (!profile) {
    return {
      userId: employeeUserId,
      karma: 0,
      events: 0,
      hours: 0,
      rank: 0,
      participationRate: 0,
    };
  }

  // Get rank among employees
  const rankResult = await KarmaProfile.countDocuments({
    userId: { $in: partner.employeeIds },
    lifetimeKarma: { $gt: profile.lifetimeKarma },
  });

  // Calculate participation rate
  const startOfYear = getStartOfYear();
  const employeeEvents = await EarnRecord.countDocuments({
    userId: employeeObjectId,
    eventId: { $in: partner.sponsoredEvents },
    status: 'APPROVED_PENDING_CONVERSION',
    approvedAt: { $gte: startOfYear },
  });

  const totalPartnerEvents = partner.sponsoredEvents.length;
  const participationRate = totalPartnerEvents > 0
    ? Math.round((employeeEvents / totalPartnerEvents) * 100)
    : 0;

  return {
    userId: employeeUserId,
    karma: profile.lifetimeKarma,
    events: profile.eventsCompleted,
    hours: Math.round(profile.totalHours),
    rank: rankResult + 1,
    participationRate,
  };
}

/**
 * Update partner statistics based on sponsored events
 */
export async function updatePartnerStats(partnerId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  const partner = await CorporatePartner.findById(partnerId);
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  const sponsoredEventIds = partner.sponsoredEvents;
  const startOfYear = getStartOfYear();

  // Aggregate stats from earn records
  const statsAggregation = await EarnRecord.aggregate([
    {
      $match: {
        eventId: { $in: sponsoredEventIds },
        status: 'APPROVED_PENDING_CONVERSION',
        approvedAt: { $gte: startOfYear },
      },
    },
    {
      $group: {
        _id: null,
        totalVolunteers: { $addToSet: '$userId' },
        totalKarma: { $sum: '$karmaEarned' },
      },
    },
    {
      $project: {
        totalVolunteers: { $size: '$totalVolunteers' },
        totalKarma: 1,
      },
    },
  ]);

  // Get event stats
  const eventStats = await KarmaEvent.aggregate([
    { $match: { _id: { $in: sponsoredEventIds }, status: 'completed' } },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        totalHours: { $sum: { $multiply: ['$expectedDurationHours', '$confirmedVolunteers'] } },
      },
    },
  ]);

  const stats = {
    totalEvents: eventStats[0]?.totalEvents || 0,
    totalVolunteers: statsAggregation[0]?.totalVolunteers || 0,
    totalHours: Math.round(eventStats[0]?.totalHours || 0),
    totalKarma: statsAggregation[0]?.totalKarma || 0,
  };

  await CorporatePartner.findByIdAndUpdate(partnerId, { stats });

  logger.info(`Updated stats for partner ${partnerId}:`, stats);
}

/**
 * Add a sponsored event to a corporate partner
 */
export async function addSponsoredEvent(
  partnerId: string,
  eventId: string,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error(`Invalid partnerId: ${partnerId}`);
  }

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw new Error(`Invalid eventId: ${eventId}`);
  }

  const partner = await CorporatePartner.findById(partnerId);
  if (!partner) {
    throw new Error(`Corporate partner not found: ${partnerId}`);
  }

  const eventObjectId = new mongoose.Types.ObjectId(eventId);

  // Check if event already sponsored
  const alreadySponsored = partner.sponsoredEvents.some(
    (e) => e.toString() === eventObjectId.toString(),
  );

  if (alreadySponsored) {
    logger.warn(`Event ${eventId} already sponsored by partner ${partnerId}`);
    return;
  }

  // Add event to sponsored list
  await CorporatePartner.findByIdAndUpdate(partnerId, {
    $push: { sponsoredEvents: eventObjectId },
  });

  // Update stats
  await updatePartnerStats(partnerId);

  logger.info(`Event ${eventId} added as sponsored by partner ${partnerId}`);
}
