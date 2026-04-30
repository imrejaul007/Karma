// @ts-nocheck
/**
 * NBKC Civic Mission Seed Data
 *
 * Seeds the civic_missions collection with sample missions across Bengaluru wards.
 * Run with: npx ts-node src/scripts/seedCivicMissions.ts
 *
 * Prerequisites:
 *   1. MongoDB must be running and accessible
 *   2. Set MONGODB_URI in your .env or environment
 *   3. The rez-karma-service must have been built at least once (npm run build)
 */

import mongoose from 'mongoose';
import { config } from 'dotenv';
import { CivicMission } from '../models/CivicMission';
import type { ICivicMission } from '../models/CivicMission';

// Load .env before connecting
config();

// ── Bengaluru wards ─────────────────────────────────────────────────────────────

const BENGALURU_WARDS = [
  'Koramangala',
  'Whitefield',
  'Indiranagar',
  'HSR Layout',
  'Marathahalli',
  'Jayanagar',
  'BTM Layout',
  'Electronic City',
  'MG Road',
  'Hebbal',
  'Yelahanka',
  'Bannerghatta',
  'Bellandur',
  'Sarjapur Road',
  'Malleshwaram',
] as const;

type Ward = (typeof BENGALURU_WARDS)[number];

// ── Sample missions by category ────────────────────────────────────────────────

const SEED_MISSIONS: Omit<ICivicMission, 'createdAt' | 'updatedAt'>[] = [
  // ── Environment ──────────────────────────────────────────────────────────────
  {
    title: 'Tree Plantation Drive at Cubbon Park',
    description:
      'Join us for a massive tree plantation drive at Cubbon Park. Help restore the green cover of Bengaluru by planting native saplings. All materials provided — just bring your enthusiasm and comfortable shoes.',
    category: 'environment',
    difficulty: 'easy',
    ward: 'Koramangala',
    location: 'Cubbon Park, Kasturba Road',
    coordinates: { lat: 12.9765, lng: 77.5952 },
    scheduledAt: getFutureDate(3, 7, 0, 9), // 3-7 days ahead, 9 AM
    durationHours: 3,
    maxVolunteers: 50,
    currentVolunteers: 12,
    karmaReward: 50,
    greenScoreReward: 30,
    status: 'active',
    organizerName: 'Bengaluru Green Foundation',
    organizerContact: 'green@bgf.org.in',
    requirements: ['Comfortable walking shoes', 'Water bottle', 'Sunscreen'],
    whatToBring: ['Cap or hat', 'Own gloves if you have them', 'Positive energy'],
  },
  {
    title: 'Lake Revival — Ulsoor Lake Cleanup',
    description:
      'Ulsoor Lake is choking with invasive weeds and plastic waste. Join our restoration mission to clean the shoreline, remove harmful vegetation, and help restore this historic lake to its former glory.',
    category: 'environment',
    difficulty: 'moderate',
    ward: 'Indiranagar',
    location: 'Ulsoor Lake, Halasuru',
    coordinates: { lat: 12.9815, lng: 77.6387 },
    scheduledAt: getFutureDate(5, 10, 0, 7),
    durationHours: 4,
    maxVolunteers: 30,
    currentVolunteers: 8,
    karmaReward: 75,
    greenScoreReward: 45,
    status: 'active',
    organizerName: 'Ulsoor Watch Association',
    organizerContact: 'contact@ulsoorwatch.org',
    requirements: ['Old clothes that can get dirty', 'Waterproof footwear', 'Mosquito repellent'],
    whatToBring: ['Gloves (provided if you don\'t have)', 'Plastic bags for waste collection'],
  },
  {
    title: 'Bannerghatta Butterfly Park Nature Trail',
    description:
      'Help maintain the nature trails at Bannerghatta Butterfly Park. Tasks include clearing fallen branches, marking trail signs, and removing invasive plants from the buffer zone.',
    category: 'environment',
    difficulty: 'easy',
    ward: 'Bannerghatta',
    location: 'Bannerghatta Biological Park',
    coordinates: { lat: 12.7946, lng: 77.5869 },
    scheduledAt: getFutureDate(7, 14, 0, 8),
    durationHours: 5,
    maxVolunteers: 20,
    currentVolunteers: 5,
    karmaReward: 60,
    greenScoreReward: 35,
    status: 'active',
    organizerName: 'Bannerghatta Conservation Trust',
    organizerContact: 'volunteer@bct.org.in',
    requirements: ['Sturdy closed shoes', 'Long pants', 'Camera (optional)'],
    whatToBring: ['Binoculars', 'Snacks', 'First aid kit if available'],
  },
  {
    title: 'Whitefield Radial Road Green Corridor',
    description:
      'Plant trees along the Whitefield Radial Road to create a green corridor that will reduce dust and provide shade for pedestrians. Joint initiative with BBMP.',
    category: 'environment',
    difficulty: 'easy',
    ward: 'Whitefield',
    location: 'Radial Road, Whitefield',
    coordinates: { lat: 12.9698, lng: 77.7499 },
    scheduledAt: getFutureDate(4, 9, 0, 7),
    durationHours: 3,
    maxVolunteers: 40,
    currentVolunteers: 15,
    karmaReward: 45,
    greenScoreReward: 25,
    status: 'active',
    organizerName: 'Whitefield Rising',
    organizerContact: 'hello@whitefieldrising.in',
    requirements: ['Gardening gloves', 'Water bottle', 'Sun protection'],
    whatToBring: ['Trowel (if available)', 'Comfortable clothes'],
  },

  // ── Water ───────────────────────────────────────────────────────────────────
  {
    title: 'Varthur Lake Desilting Volunteer Day',
    description:
      'Varthur Lake, one of Bengaluru\'s largest lakes, needs help with its annual desilting. Volunteers will assist with removing accumulated silt and managing aquatic vegetation.',
    category: 'water',
    difficulty: 'challenging',
    ward: 'Sarjapur Road',
    location: 'Varthur Lake, Varthur',
    coordinates: { lat: 12.9322, lng: 77.7794 },
    scheduledAt: getFutureDate(6, 12, 0, 6),
    durationHours: 6,
    maxVolunteers: 25,
    currentVolunteers: 3,
    karmaReward: 100,
    greenScoreReward: 60,
    status: 'active',
    organizerName: 'Varthur Lake Stakeholders Forum',
    organizerContact: 'volunteer@varthurlake.org',
    requirements: ['Rubber boots (mandatory)', 'Old clothes', 'Work gloves'],
    whatToBring: ['Change of clothes', 'Soap/towel', 'Energy snacks'],
  },
  {
    title: 'Bellandur Lake Bird Count & Cleanup',
    description:
      'Join our citizen science initiative at Bellandur Lake. Count migratory birds, record water quality observations, and participate in a community cleanup of the lake perimeter.',
    category: 'water',
    difficulty: 'easy',
    ward: 'Bellandur',
    location: 'Bellandur Lake, Bellandur',
    coordinates: { lat: 12.9352, lng: 77.6766 },
    scheduledAt: getFutureDate(2, 8, 0, 7),
    durationHours: 3,
    maxVolunteers: 35,
    currentVolunteers: 18,
    karmaReward: 55,
    greenScoreReward: 40,
    status: 'active',
    organizerName: 'Bellandur Lake Restoration Initiative',
    organizerContact: 'care@bellandurlake.in',
    requirements: ['Binoculars (for bird watching)', 'Water bottle', 'Notebook and pen'],
    whatToBring: ['Camera with zoom', 'Bird identification guide (we provide)'],
  },
  {
    title: 'Hebbal Lake Wetland Restoration',
    description:
      'Help restore the wetland ecosystem at Hebbal Lake. Activities include removing invasive water hyacinth, planting native wetland plants, and setting up nesting platforms for water birds.',
    category: 'water',
    difficulty: 'moderate',
    ward: 'Hebbal',
    location: 'Hebbal Lake, Hebbal',
    coordinates: { lat: 13.0359, lng: 77.5972 },
    scheduledAt: getFutureDate(8, 15, 0, 7),
    durationHours: 4,
    maxVolunteers: 20,
    currentVolunteers: 7,
    karmaReward: 70,
    greenScoreReward: 50,
    status: 'active',
    organizerName: 'Wetland Revival Bengaluru',
    organizerContact: 'team@wetlandrevival.org',
    requirements: ['Waterproof boots or sandals', 'Old shorts', 'Sun hat'],
    whatToBring: ['Rubber gloves', 'Plastic collection bags'],
  },

  // ── Waste ───────────────────────────────────────────────────────────────────
  {
    title: 'HSR Layout Dry Waste Segregation Drive',
    description:
      'Door-to-door dry waste segregation awareness and collection in HSR Layout. Help residents understand proper waste categorization and collect segregated waste for recycling.',
    category: 'waste',
    difficulty: 'easy',
    ward: 'HSR Layout',
    location: 'HSR Layout Sector 2 Community Centre',
    coordinates: { lat: 12.9121, lng: 77.6446 },
    scheduledAt: getFutureDate(1, 6, 0, 8),
    durationHours: 3,
    maxVolunteers: 25,
    currentVolunteers: 20,
    karmaReward: 35,
    greenScoreReward: 20,
    status: 'active',
    organizerName: 'HSR Welfare Association',
    organizerContact: 'green@hsrwa.org',
    requirements: ['Comfortable walking shoes', 'Apron or old shirt'],
    whatToBring: ['Segregation guide (provided)', 'Clipboard for data collection'],
  },
  {
    title: 'Marathahalli E-Waste Collection Camp',
    description:
      'An e-waste collection drive at Marathahalli Junction. Help collect, categorize, and safely store electronic waste for proper recycling. Old phones, chargers, batteries — everything counts.',
    category: 'waste',
    difficulty: 'easy',
    ward: 'Marathahalli',
    location: 'Marathahalli Bridge Junction',
    coordinates: { lat: 12.9562, lng: 77.7017 },
    scheduledAt: getFutureDate(4, 11, 0, 10),
    durationHours: 4,
    maxVolunteers: 15,
    currentVolunteers: 9,
    karmaReward: 40,
    greenScoreReward: 25,
    status: 'active',
    organizerName: 'EcoMarathahalli',
    organizerContact: 'collect@marathahallieco.in',
    requirements: ['Safety gloves (provided)', 'Safety goggles (provided)'],
    whatToBring: ['Closed-toe shoes', 'Long sleeves'],
  },
  {
    title: 'Electronic City E-Waste & Plastic Cleanup',
    description:
      'Electronic City generates tonnes of e-waste monthly. Join our cleanup and collection drive targeting the IT campus areas and surrounding neighborhoods.',
    category: 'waste',
    difficulty: 'moderate',
    ward: 'Electronic City',
    location: 'Electronic City Phase 1, Near Infosys Campus',
    coordinates: { lat: 12.8461, lng: 77.6603 },
    scheduledAt: getFutureDate(5, 13, 0, 7),
    durationHours: 5,
    maxVolunteers: 40,
    currentVolunteers: 11,
    karmaReward: 65,
    greenScoreReward: 40,
    status: 'active',
    organizerName: 'ECity Green Warriors',
    organizerContact: 'volunteer@ecitygreen.org',
    requirements: ['Heavy-duty gloves', 'Dust mask', 'Closed shoes'],
    whatToBring: ['Wheelbarrow (if available)', 'Cable ties for bundling'],
  },

  // ── Civic ──────────────────────────────────────────────────────────────────
  {
    title: 'BBMP Road Repair Reporting & Pothole Mapping',
    description:
      'Walk your ward and map potholes, broken footpaths, and damaged roads. Your data will be submitted to BBMP for repair prioritization. Training provided on the BBMP311 app.',
    category: 'civic',
    difficulty: 'easy',
    ward: 'Jayanagar',
    location: 'Jayanagar 4th Block Main Road',
    coordinates: { lat: 12.9299, lng: 77.5833 },
    scheduledAt: getFutureDate(2, 7, 0, 8),
    durationHours: 3,
    maxVolunteers: 20,
    currentVolunteers: 14,
    karmaReward: 30,
    greenScoreReward: 15,
    status: 'active',
    organizerName: 'JayanagarCitizens Forum',
    organizerContact: 'civic@jncforum.org',
    requirements: ['Smartphone with BBMP311 app (installed)', 'Comfortable walking shoes'],
    whatToBring: ['Power bank', 'Umbrella (monsoon)'],
  },
  {
    title: 'BTM Layout Storm Drain Cleaning',
    description:
      'BTM Layout is flood-prone during monsoons. Help clean storm drains and nullah approaches before the rains arrive. Critical civic maintenance work that helps the entire neighborhood.',
    category: 'civic',
    difficulty: 'challenging',
    ward: 'BTM Layout',
    location: 'BTM Layout 2nd Stage, Near Forum Mall',
    coordinates: { lat: 12.9157, lng: 77.6102 },
    scheduledAt: getFutureDate(3, 8, 0, 6),
    durationHours: 4,
    maxVolunteers: 30,
    currentVolunteers: 6,
    karmaReward: 80,
    greenScoreReward: 35,
    status: 'active',
    organizerName: 'BTM Layout RWA',
    organizerContact: 'help@btmrwa.in',
    requirements: ['Heavy gloves', 'Dust mask', 'Rain boots'],
    whatToBring: ['Headlamp or torch', 'Plastic sheets for covering'],
  },
  {
    title: 'Malleshwaram Heritage Walk & Civic Survey',
    description:
      'Explore Malleshwaram\'s rich heritage while documenting civic infrastructure needs. Survey heritage buildings, document maintenance issues, and map public amenity availability.',
    category: 'civic',
    difficulty: 'easy',
    ward: 'Malleshwaram',
    location: 'Malleshwaram 8th Cross, Near Mantri Square',
    coordinates: { lat: 13.0037, lng: 77.5707 },
    scheduledAt: getFutureDate(6, 14, 0, 7),
    durationHours: 3,
    maxVolunteers: 15,
    currentVolunteers: 10,
    karmaReward: 35,
    greenScoreReward: 20,
    status: 'active',
    organizerName: 'Malleshwaram Heritage Trust',
    organizerContact: 'heritage@malltrust.org',
    requirements: ['Comfortable walking shoes', 'Smartphone for photos'],
    whatToBring: ['Notebook', 'Camera'],
  },

  // ── Community ───────────────────────────────────────────────────────────────
  {
    title: 'Koramangala Senior Citizen Digital Literacy',
    description:
      'Help senior citizens in Koramangala learn to use smartphones, video call family, access government services online, and stay safe from digital fraud. No teaching experience needed — just patience.',
    category: 'community',
    difficulty: 'easy',
    ward: 'Koramangala',
    location: 'Koramangala Social, 5th Block',
    coordinates: { lat: 12.9352, lng: 77.6145 },
    scheduledAt: getFutureDate(2, 5, 0, 10),
    durationHours: 3,
    maxVolunteers: 10,
    currentVolunteers: 7,
    karmaReward: 40,
    greenScoreReward: 10,
    status: 'active',
    organizerName: 'SilverSurfers Bengaluru',
    organizerContact: 'teach@silversurfers.in',
    requirements: ['Patient and friendly demeanor', 'Own smartphone for demo'],
    whatToBring: ['Printed guides (provided)', 'Charging cables for seniors'],
  },
  {
    title: 'Yelahanka Village School Supplies Drive',
    description:
      'Distribute school supplies to underprivileged children in Yelahanka village. Volunteers will help with distribution, interact with students, and potentially conduct fun learning activities.',
    category: 'community',
    difficulty: 'easy',
    ward: 'Yelahanka',
    location: 'Yelahanka Village Govt. School',
    coordinates: { lat: 13.1005, lng: 77.5965 },
    scheduledAt: getFutureDate(7, 16, 0, 9),
    durationHours: 4,
    maxVolunteers: 25,
    currentVolunteers: 13,
    karmaReward: 60,
    greenScoreReward: 20,
    status: 'active',
    organizerName: 'VidyutShiksha Foundation',
    organizerContact: 'volunteer@vidyutshiksha.org',
    requirements: ['Patient attitude with children', 'Nothing to wear that might stain'],
    whatToBring: ['Books or learning games (optional)', 'Snacks for children (sealed pack)'],
  },
  {
    title: 'MG Road Public Space Art Restoration',
    description:
      'MG Road has vibrant murals and public art that\'s fading. Help clean and restore public art installations. Art conservation training provided — no prior experience needed.',
    category: 'community',
    difficulty: 'moderate',
    ward: 'MG Road',
    location: 'MG Road Promenade, Near Trinity Circle',
    coordinates: { lat: 12.9751, lng: 77.6093 },
    scheduledAt: getFutureDate(3, 9, 0, 7),
    durationHours: 4,
    maxVolunteers: 15,
    currentVolunteers: 4,
    karmaReward: 55,
    greenScoreReward: 25,
    status: 'active',
    organizerName: 'Bengaluru Urban Art Collective',
    organizerContact: 'create@buac.in',
    requirements: ['Old clothes', 'Gloves provided'],
    whatToBring: ['Art supplies (optional)', 'Camera'],
  },
];

// ── Helper: get a future date ─────────────────────────────────────────────────

/**
 * Returns a Date between `minDaysFromNow` and `maxDaysFromNow` (inclusive),
 * at a specific hour on a Saturday.
 */
function getFutureDate(minDaysFromNow: number, maxDaysFromNow: number, _seed: number, hour: number): Date {
  // Use a fixed "now" so seed data is stable across runs
  const now = new Date('2026-04-27T00:00:00.000Z');
  const minMs = (minDaysFromNow) * 24 * 60 * 60 * 1000;
  const maxMs = (maxDaysFromNow) * 24 * 60 * 60 * 1000;
  const range = maxMs - minMs;
  const offset = range > 0 ? Math.floor(Math.random() * range) : 0;
  const ms = now.getTime() + minMs + offset;

  // Snap to the next Saturday at `hour`
  const date = new Date(ms);
  const dayDiff = (6 - date.getUTCDay() + 7) % 7 || 7; // days until Saturday
  date.setUTCDate(date.getUTCDate() + dayDiff);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

// ── Main ─────────────────────────────────────────────────────────────────────────

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/rez_karma';
  console.log(`Connecting to MongoDB: ${uri}`);

  await mongoose.connect(uri);
  console.log('Connected.\n');

  // Wipe existing seed data
  const deleted = await CivicMission.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing missions.\n`);

  // Insert all seed missions
  const inserted = await CivicMission.insertMany(SEED_MISSIONS);
  console.log(`Inserted ${inserted.length} missions:\n`);

  // Group by category and print summary
  const byCategory: Record<string, number> = {};
  for (const m of SEED_MISSIONS) {
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }
  console.log('By category:');
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count} missions`);
  }
  console.log();

  const byWard: Record<string, number> = {};
  for (const m of SEED_MISSIONS) {
    byWard[m.ward] = (byWard[m.ward] ?? 0) + 1;
  }
  console.log('By ward:');
  for (const [ward, count] of Object.entries(byWard)) {
    console.log(`  ${ward}: ${count} missions`);
  }
  console.log();

  await mongoose.disconnect();
  console.log('Done. MongoDB disconnected.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
