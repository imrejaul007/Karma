// @ts-nocheck
// @ts-ignore
import mongoose from 'mongoose';
import { CauseCommunity, CauseCommunityDocument, CommunityCategory } from '../models/CauseCommunity';
import { CommunityPost, CommunityPostDocument, PostAuthorType } from '../models/CommunityPost';
import { notifyFollowersOfNewPost } from './notificationService.js';
import { logger } from '../config/logger.js';

export interface CommunityWithStats {
  _id: string;
  name: string;
  slug: string;
  description: string;
  category: CommunityCategory;
  coverImage: string;
  icon: string;
  ngoAdmins: string[];
  followerCount: number;
  isFollowing: boolean;
  stats: {
    eventsHosted: number;
    totalVolunteers: number;
    totalHours: number;
  };
  recentPosts: CommunityPostSummary[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityPostSummary {
  _id: string;
  communityId: string;
  authorId: string;
  authorType: PostAuthorType;
  content: string;
  mediaUrls: string[];
  karmaEarned: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converts a CauseCommunityDocument + userId to a CommunityWithStats response.
 */
async function toCommunityWithStats(
  community: CauseCommunityDocument,
  userId?: string,
): Promise<CommunityWithStats> {
  const userOid = userId ? new mongoose.Types.ObjectId(userId) : null;
  const isFollowing = userOid
    ? community.followerIds.some((id) => id.equals(userOid!))
    : false;

  // Fetch recent posts (most recent first, limit 5)
  const recentPostsRaw = await CommunityPost.find({ communityId: community._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const recentPosts: CommunityPostSummary[] = recentPostsRaw.map((p) => ({
    _id: (p._id as mongoose.Types.ObjectId).toString(),
    communityId: (p.communityId as mongoose.Types.ObjectId).toString(),
    authorId: (p.authorId as mongoose.Types.ObjectId).toString(),
    authorType: p.authorType,
    content: p.content,
    mediaUrls: p.mediaUrls,
    karmaEarned: p.karmaEarned,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    tags: p.tags,
    isPinned: p.isPinned,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return {
    _id: community._id.toString(),
    name: community.name,
    slug: community.slug,
    description: community.description,
    category: community.category,
    coverImage: community.coverImage,
    icon: community.icon,
    ngoAdmins: community.ngoAdmins.map((id) => id.toString()),
    followerCount: community.followerCount,
    isFollowing,
    stats: {
      eventsHosted: community.stats.eventsHosted,
      totalVolunteers: community.stats.totalVolunteers,
      totalHours: community.stats.totalHours,
    },
    recentPosts,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
  };
}

/**
 * Get all communities with optional user following status.
 */
export async function getAllCommunities(userId?: string): Promise<CommunityWithStats[]> {
  const communities = await CauseCommunity.find()
    .sort({ followerCount: -1, name: 1 })
    .lean();

  return Promise.all(
    communities.map((c) =>
      toCommunityWithStats(c as unknown as CauseCommunityDocument, userId),
    ),
  );
}

/**
 * Get a single community by slug.
 */
export async function getCommunity(
  slug: string,
  userId?: string,
): Promise<CommunityWithStats | null> {
  const community = await CauseCommunity.findOne({ slug }).lean();
  if (!community) return null;
  return toCommunityWithStats(community as unknown as CauseCommunityDocument, userId);
}

/**
 * Get community feed (posts) with pagination.
 */
export async function getCommunityFeed(
  slugOrId: string,
  page: number,
  limit: number,
): Promise<CommunityPostSummary[]> {
  // Support both slug and ObjectId
  let communityId: mongoose.Types.ObjectId;
  if (mongoose.Types.ObjectId.isValid(slugOrId)) {
    communityId = new mongoose.Types.ObjectId(slugOrId);
  } else {
    const community = await CauseCommunity.findOne({ slug: slugOrId })
      .select('_id')
      .lean();
    if (!community) return [];
    communityId = (community._id as mongoose.Types.ObjectId);
  }

  const skip = (page - 1) * limit;
  const posts = await CommunityPost.find({ communityId })
    .sort({ isPinned: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return posts.map((p) => ({
    _id: (p._id as mongoose.Types.ObjectId).toString(),
    communityId: (p.communityId as mongoose.Types.ObjectId).toString(),
    authorId: (p.authorId as mongoose.Types.ObjectId).toString(),
    authorType: p.authorType,
    content: p.content,
    mediaUrls: p.mediaUrls,
    karmaEarned: p.karmaEarned,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    tags: p.tags,
    isPinned: p.isPinned,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

/**
 * Follow a community.
 */
export async function followCommunity(
  userId: string,
  slug: string,
): Promise<void> {
  const community = await CauseCommunity.findOne({ slug });
  if (!community) {
    throw new Error('Community not found');
  }
  await community.addFollower(userId);
}

/**
 * Unfollow a community.
 */
export async function unfollowCommunity(
  userId: string,
  slug: string,
): Promise<void> {
  const community = await CauseCommunity.findOne({ slug });
  if (!community) {
    throw new Error('Community not found');
  }
  await community.removeFollower(userId);
}

/**
 * Create a new post in a community.
 */
export async function createPost(
  slug: string,
  authorId: string,
  authorType: PostAuthorType,
  content: string,
  mediaUrls?: string[],
): Promise<CommunityPostSummary> {
  const community = await CauseCommunity.findOne({ slug });
  if (!community) {
    throw new Error('Community not found');
  }

  const post = new CommunityPost({
    communityId: community._id,
    authorId: new mongoose.Types.ObjectId(authorId),
    authorType,
    content,
    mediaUrls: mediaUrls ?? [],
    karmaEarned: 0,
    likes: [],
    likeCount: 0,
    commentCount: 0,
    tags: [],
    isPinned: false,
  });

  await post.save();
  await community.addPost(post._id);

  // Send notifications to followers (fire-and-forget)
  const followerIds = community.followerIds.map((id) => id.toString());
  notifyFollowersOfNewPost(
    authorId,
    community.name,
    community.slug,
    post._id.toString(),
    content,
    followerIds,
  ).catch((err) => {
    logger.error('[CommunityService] Failed to send post notifications', { error: err });
  });

  return {
    _id: post._id.toString(),
    communityId: community._id.toString(),
    authorId: post.authorId.toString(),
    authorType: post.authorType,
    content: post.content,
    mediaUrls: post.mediaUrls,
    karmaEarned: post.karmaEarned,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    tags: post.tags,
    isPinned: post.isPinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

/**
 * Like or unlike a post.
 */
export async function likePost(userId: string, postId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    throw new Error('Invalid postId');
  }
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid userId');
  }

  const post = await CommunityPost.findById(postId);
  if (!post) {
    throw new Error('Post not found');
  }

  const userOid = new mongoose.Types.ObjectId(userId);
  const alreadyLiked = post.likes.some((id) => id.equals(userOid));

  if (alreadyLiked) {
    post.likes = post.likes.filter((id) => !id.equals(userOid));
  } else {
    post.likes.push(userOid);
  }

  post.likeCount = post.likes.length;
  await post.save();
}

/**
 * Get communities recommended for a user based on their following.
 * Returns communities the user is not yet following.
 */
export async function getRecommendedCommunities(
  userId: string,
): Promise<CommunityWithStats[]> {
  const userOid = new mongoose.Types.ObjectId(userId);

  // Find communities the user already follows
  const following = await CauseCommunity.find({ followerIds: userOid })
    .select('category')
    .lean();

  const followingCategories = following.map((c) => c.category);

  // Find communities not followed by this user
  const query = followingCategories.length > 0
    ? {
        _id: { $nin: [] as mongoose.Types.ObjectId[] },
        followerIds: { $ne: userOid },
      }
    : { followerIds: { $ne: userOid } };

  // If user has no following, return top communities by follower count
  const recommended = await CauseCommunity.find(query)
    .sort({ followerCount: -1 })
    .limit(10)
    .lean();

  return Promise.all(
    recommended.map((c) =>
      toCommunityWithStats(c as unknown as CauseCommunityDocument, userId),
    ),
  );
}

/**
 * Get communities that a user follows.
 */
export async function getUserCommunities(
  userId: string,
): Promise<CommunityWithStats[]> {
  const userOid = new mongoose.Types.ObjectId(userId);
  const communities = await CauseCommunity.find({ followerIds: userOid })
    .sort({ followerCount: -1, name: 1 })
    .lean();

  return Promise.all(
    communities.map((c) =>
      toCommunityWithStats(c as unknown as CauseCommunityDocument, userId),
    ),
  );
}
