// ── Shared types across all tools ──

export interface SearchTermRecord {
  searchTerm: string;
  campaign?: string;
  adGroup?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  matchType?: 'exact' | 'phrase' | 'broad' | 'auto';
  landingPage?: string;
}

export interface ProductRecord {
  productId: string;
  title: string;
  category: string;
  brand?: string;
  price: number;
  costOfGoods?: number;
  grossMargin?: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  customLabels?: string[];
}

export type IntentCategory =
  | 'brand'
  | 'competitor'
  | 'high-intent-transactional'
  | 'informational'
  | 'navigational'
  | 'long-tail'
  | 'generic';

export type ProfitabilityTier = 'profitable' | 'marginal' | 'wasteful';

export type TriageAction =
  | 'add_negative'
  | 'isolate_new_adgroup'
  | 'isolate_new_campaign'
  | 'leave_in_broad'
  | 'leave_in_pmax'
  | 'push_feed_title_update'
  | 'create_landing_page_gap_note';

export interface TriageActionItem {
  searchTerm: string;
  action: TriageAction;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggestedDestination?: string;
  estimatedImpact?: {
    costSavings?: number;
    potentialRevenue?: number;
  };
}
