import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type PostAuthorType = 'ngo' | 'volunteer';

export interface ICommunityPost {
  _id: Types.ObjectId;
  communityId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorType: PostAuthorType;
  content: string;
  mediaUrls: string[];
  karmaEarned: number;
  likes: Types.ObjectId[];
  likeCount: number;
  commentCount: number;
  tags: string[];
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityPostDocument extends Omit<ICommunityPost, '_id'>, Document {
  _id: Types.ObjectId;
}

const CommunityPostSchema = new Schema<CommunityPostDocument>(
  {
    communityId: {
      type: Schema.Types.ObjectId,
      ref: 'CauseCommunity',
      required: true,
      index: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorType: {
      type: String,
      required: true,
      enum: ['ngo', 'volunteer'] as PostAuthorType[],
    },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    mediaUrls: {
      type: [String],
      default: [],
    },
    karmaEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    likes: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    tags: {
      type: [String],
      default: [],
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'community_posts',
  },
);

// Pre-save: sync likeCount with likes.length
CommunityPostSchema.pre('save', function (next) {
  if (this.isModified('likes')) {
    this.likeCount = this.likes.length;
  }
  next();
});

// Compound index for feed queries: community sorted by createdAt
CommunityPostSchema.index({ communityId: 1, createdAt: -1 });

export const CommunityPost: Model<CommunityPostDocument> =
  mongoose.models.CommunityPost ||
  mongoose.model<CommunityPostDocument>('CommunityPost', CommunityPostSchema);
