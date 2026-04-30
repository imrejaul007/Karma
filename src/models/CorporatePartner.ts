// @ts-nocheck
// @ts-ignore
import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Corporate Partner tiers for CSR program categorization
 */
export type CorporatePartnerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * CSR Report metadata for generated PDF reports
 */
export interface ICsrReport {
  year: number;
  quarter: number;
  generatedAt: Date;
  pdfUrl: string;
}

/**
 * Corporate Partner statistics tracking
 */
export interface ICorporateStats {
  totalEvents: number;
  totalVolunteers: number;
  totalHours: number;
  totalKarma: number;
}

/**
 * Corporate Partner document interface
 * Represents a company enrolled in the CSR Cloud program
 */
export interface CorporatePartnerDocument extends Omit<ICorporatePartner, '_id'>, Document {
  _id: mongoose.Types.ObjectId;
}

export interface ICorporatePartner {
  _id: mongoose.Types.ObjectId;
  companyName: string;
  companySlug: string;
  logoUrl: string;
  contactEmail: string;
  tier: CorporatePartnerTier;
  sponsoredEvents: mongoose.Types.ObjectId[];
  creditsBudget: number;
  creditsUsed: number;
  employeeIds: mongoose.Types.ObjectId[];
  stats: ICorporateStats;
  reports: ICsrReport[];
  createdAt: Date;
  updatedAt: Date;
}

const CsrReportSchema = new Schema<ICsrReport>(
  {
    year: { type: Number, required: true },
    quarter: { type: Number, required: true, min: 1, max: 4 },
    generatedAt: { type: Date, required: true },
    pdfUrl: { type: String, required: true },
  },
  { _id: false },
);

const CorporateStatsSchema = new Schema<ICorporateStats>(
  {
    totalEvents: { type: Number, default: 0, min: 0 },
    totalVolunteers: { type: Number, default: 0, min: 0 },
    totalHours: { type: Number, default: 0, min: 0 },
    totalKarma: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const CorporatePartnerSchema = new Schema<CorporatePartnerDocument>(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    companySlug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    logoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    tier: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum'] as CorporatePartnerTier[],
      default: 'bronze',
    },
    sponsoredEvents: [{
      type: Schema.Types.ObjectId,
      ref: 'KarmaEvent',
    }],
    creditsBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    creditsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    employeeIds: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
    stats: {
      type: CorporateStatsSchema,
      default: () => ({
        totalEvents: 0,
        totalVolunteers: 0,
        totalHours: 0,
        totalKarma: 0,
      }),
    },
    reports: {
      type: [CsrReportSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'corporate_partners',
  },
);

// Compound indexes for common query patterns
CorporatePartnerSchema.index({ tier: 1, createdAt: -1 });
CorporatePartnerSchema.index({ 'stats.totalKarma': -1 });

export const CorporatePartner: Model<CorporatePartnerDocument> =
  mongoose.models.CorporatePartner ||
  mongoose.model<CorporatePartnerDocument>('CorporatePartner', CorporatePartnerSchema);
