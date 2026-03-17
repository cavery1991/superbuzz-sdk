// ── SuperBuzz SDK ──
// Search query mining, PMax segmentation, and search term triage tools
// for Google Ads optimization

// Search Query Mining Tool
export { SearchQueryMiner } from './search-query-mining';
export type { SearchQueryMiningConfig, MiningReport } from './search-query-mining';
export {
  IntentClassifier,
  ProfitabilityAnalyzer,
  QueryClusterer,
  NegativeKeywordFinder,
  ExpansionFinder,
} from './search-query-mining';

// PMax Segmentation Recommender
export { SegmentationEngine, MarginCalculator, PerformanceScorer } from './pmax-segmentation';
export type {
  SegmentationConfig,
  SegmentationReport,
  CampaignRecommendation,
  AssetGroupRecommendation,
} from './pmax-segmentation';

// Search Term Triage Assistant
export { TriageEngine, LandingPageAnalyzer, FeedTitleMatcher } from './search-term-triage';
export type { TriageConfig, TriageReport } from './search-term-triage';

// Shared types
export type {
  SearchTermRecord,
  ProductRecord,
  IntentCategory,
  ProfitabilityTier,
  TriageAction,
  TriageActionItem,
} from './shared/types';
