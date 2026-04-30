// -nocheck
import { CauseCommunity, CommunityCategory } from '../models/CauseCommunity';
import { logger } from './logger';

interface SeedCommunity {
  name: string;
  slug: string;
  description: string;
  category: CommunityCategory;
  icon: string;
  coverImage: string;
}

const DEFAULT_COMMUNITIES: SeedCommunity[] = [
  {
    name: 'Environment Champions',
    slug: 'environment-champions',
    description:
      'Join volunteers dedicated to protecting our planet through tree planting, cleanup drives, recycling initiatives, and sustainable living advocacy.',
    category: 'environment',
    icon: '🌍',
    coverImage: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&h=400&fit=crop',
  },
  {
    name: 'Food Security Alliance',
    slug: 'food-security-alliance',
    description:
      'United against hunger. We run food banks, community kitchens, and meal distribution programs to ensure no one goes hungry in our communities.',
    category: 'food',
    icon: '🍽️',
    coverImage: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1200&h=400&fit=crop',
  },
  {
    name: 'Health Heroes',
    slug: 'health-heroes',
    description:
      'Healthcare volunteers providing medical camps, health awareness, blood donation drives, and support for underserved communities.',
    category: 'health',
    icon: '🏥',
    coverImage: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1200&h=400&fit=crop',
  },
  {
    name: 'Education for All',
    slug: 'education-for-all',
    description:
      'Bridging the education gap. We tutor, mentor, and support students in underprivileged areas with learning materials and scholarship guidance.',
    category: 'education',
    icon: '📚',
    coverImage: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1200&h=400&fit=crop',
  },
  {
    name: 'Community Builders',
    slug: 'community-builders',
    description:
      'Strengthening neighborhoods through volunteerism, skill-sharing workshops, elderly care programs, and inclusive community events.',
    category: 'community',
    icon: '🤝',
    coverImage: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1200&h=400&fit=crop',
  },
];

/**
 * Seeds default Cause Communities if they do not already exist.
 * Idempotent: safe to call on every startup.
 */
export async function seedCommunities(): Promise<void> {
  for (const seed of DEFAULT_COMMUNITIES) {
    try {
      const existing = await CauseCommunity.findOne({ slug: seed.slug });
      if (existing) {
        logger.info(`[communitySeed] Community "${seed.name}" already exists, skipping`);
        continue;
      }

      const community = new CauseCommunity({
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        category: seed.category,
        icon: seed.icon,
        coverImage: seed.coverImage,
        ngoAdmins: [],
        followerIds: [],
        followerCount: 0,
        postIds: [],
        stats: {
          eventsHosted: 0,
          totalVolunteers: 0,
          totalHours: 0,
        },
      });

      await community.save();
      logger.info(`[communitySeed] Created community: "${seed.name}"`);
    } catch (err) {
      logger.error(`[communitySeed] Failed to seed community "${seed.name}"`, { error: err });
    }
  }

  logger.info('[communitySeed] Seeding complete');
}
