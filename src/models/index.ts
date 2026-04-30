// @ts-ignore
export { KarmaProfile } from './KarmaProfile';
export type { KarmaProfileDocument, IKarmaProfile, IBadge, ILevelHistoryEntry, IConversionHistoryEntry } from './KarmaProfile';

export { UserDevice } from './UserDevice';
export type { UserDeviceDocument, IUserDevice, DevicePlatform } from './UserDevice';

export { KarmaEvent } from './KarmaEvent';
export type { KarmaEventDocument, IKarmaEvent, IQRCodeSet } from './KarmaEvent';

export { EarnRecord } from './EarnRecord';
export type { EarnRecordDocument, IEarnRecord } from './EarnRecord';

export { Batch } from './Batch';
export type { BatchDocument, IBatch, IAnomalyFlag } from './Batch';

export { CSRPool } from './CSRPool';
export type { CSRPoolDocument, ICSRPool } from './CSRPool';

export { UserMission } from './KarmaMission';
export type { IUserMission } from './KarmaMission';

export { Perk } from './Perk';
export type { IPerk, PerkType } from './Perk';

export { PerkClaim } from './PerkClaim';
export type { IPerkClaim, PerkClaimStatus } from './PerkClaim';

export { CauseCommunity } from './CauseCommunity';
export type { CauseCommunityDocument, ICauseCommunity, ICommunityStats, CommunityCategory } from './CauseCommunity';

export { CommunityPost } from './CommunityPost';
export type { CommunityPostDocument, ICommunityPost, PostAuthorType } from './CommunityPost';

export { MicroAction } from './MicroAction';
export type { MicroActionDocument, IMicroAction, MicroActionType } from './MicroAction';

export { CorporatePartner } from './CorporatePartner';
export type { CorporatePartnerDocument, ICorporatePartner, CorporatePartnerTier, ICsrReport, ICorporateStats } from './CorporatePartner';

export { CsrAllocation } from './CsrAllocation';
export type { CsrAllocationDocument, ICsRAllocation, CsrAllocationStatus } from './CsrAllocation';

export { NBKCMembership } from './NBKCMembership';
export type { NBKCMembershipDocument, NBKCMembershipModel, INBKCMembership, NBKCMembershipTier } from './NBKCMembership';

export { GreenScoreProfile } from './GreenScoreProfile';
export type { GreenScoreProfileDocument, IGreenScoreProfile, IGreenAction, GreenActionType } from './GreenScoreProfile';

export { CivicMission, CivicMissionEnrollment } from './CivicMission';
export type {
  CivicMissionDocument,
  CivicMissionEnrollmentDocument,
  ICivicMission,
  ICivicMissionEnrollment,
  CivicMissionCategory,
  CivicMissionStatus,
  CivicMissionDifficulty,
} from './CivicMission';

export { Intent } from './Intent';
export type {
  IIntent,
  IIntentSignal,
} from './Intent';

// Re-export leaderboard types for convenience
export type {
  LeaderboardScope,
  LeaderboardPeriod,
  LeaderboardEntry,
  LeaderboardResult,
} from '../services/leaderboardService';
