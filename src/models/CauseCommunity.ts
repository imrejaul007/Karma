import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type CommunityCategory = 'environment' | 'food' | 'health' | 'education' | 'community';

export interface ICommunityStats {
  eventsHosted: number;
  totalVolunteers: number;
  totalHours: number;
}

export interface ICauseCommunity {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  category: CommunityCategory;
  coverImage: string;
  icon: string;
  ngoAdmins: Types.ObjectId[];
  followerIds: Types.ObjectId[];
  followerCount: number;
  postIds: Types.ObjectId[];
  stats: ICommunityStats;
  createdAt: Date;
  updatedAt: Date;
}

export interface CauseCommunityDocument extends Omit<ICauseCommunity, '_id'>, Document {
  _id: Types.ObjectId;
  addFollower(userId: Types.ObjectId | string): Promise<void>;
  removeFollower(userId: Types.ObjectId | string): Promise<void>;
  addPost(postId: Types.ObjectId | string): Promise<void>;
}

const CommunityStatsSchema = new Schema<ICommunityStats>(
  {
    eventsHosted: { type: Number, default: 0, min: 0 },
    totalVolunteers: { type: Number, default: 0, min: 0 },
    totalHours: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const CauseCommunitySchema = new Schema<CauseCommunityDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 500,
    },
    category: {
      type: String,
      required: true,
      enum: ['environment', 'food', 'health', 'education', 'community'] as CommunityCategory[],
      index: true,
    },
    coverImage: {
      type: String,
      default: '',
    },
    icon: {
      type: String,
      default: '',
    },
    ngoAdmins: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    followerIds: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
      index: true,
    },
    followerCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    postIds: {
      type: [Schema.Types.ObjectId],
      ref: 'CommunityPost',
      default: [],
    },
    stats: {
      type: CommunityStatsSchema,
      default: () => ({
        eventsHosted: 0,
        totalVolunteers: 0,
        totalHours: 0,
      }),
    },
  },
  {
    timestamps: true,
    collection: 'cause_communities',
  },
);

// Pre-save: sync followerCount with followerIds.length
CauseCommunitySchema.pre('save', function (next) {
  if (this.isModified('followerIds')) {
    this.followerCount = this.followerIds.length;
  }
  next();
});

// Instance method: add a follower
CauseCommunitySchema.methods.addFollower = async function (
  userId: Types.ObjectId | string,
): Promise<void> {
  const userOid =
    typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  if (!this.followerIds.some((id: mongoose.Types.ObjectId) => id.equals(userOid))) {
    this.followerIds.push(userOid);
    this.followerCount = this.followerIds.length;
    await this.save();
  }
};

// Instance method: remove a follower
CauseCommunitySchema.methods.removeFollower = async function (
  userId: Types.ObjectId | string,
): Promise<void> {
  const userOid =
    typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  this.followerIds = this.followerIds.filter((id: mongoose.Types.ObjectId) => !id.equals(userOid));
  this.followerCount = this.followerIds.length;
  await this.save();
};

// Instance method: add a post
CauseCommunitySchema.methods.addPost = async function (
  postId: Types.ObjectId | string,
): Promise<void> {
  const postOid =
    typeof postId === 'string' ? new Types.ObjectId(postId) : postId;
  if (!this.postIds.some((id: mongoose.Types.ObjectId) => id.equals(postOid))) {
    this.postIds.push(postOid);
    await this.save();
  }
};

// Indexes
CauseCommunitySchema.index({ slug: 1 }, { unique: true });
CauseCommunitySchema.index({ category: 1 });
CauseCommunitySchema.index({ followerIds: 1 });

export const CauseCommunity: Model<CauseCommunityDocument> =
  mongoose.models.CauseCommunity ||
  mongoose.model<CauseCommunityDocument>('CauseCommunity', CauseCommunitySchema);
