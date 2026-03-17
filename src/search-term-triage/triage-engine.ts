import { SearchTermRecord, TriageAction, TriageActionItem } from '../shared/types';
import { calcMetrics } from '../shared/metrics';
import { tokenize } from '../shared/tokenizer';
import { LandingPageAnalyzer, LandingPageGap } from './landing-page-analyzer';
import { FeedTitleMatcher, FeedTitleConfig, FeedTitleUpdate } from './feed-title-matcher';

export interface TriageConfig {
  /** Target ROAS for the account (default: 3.0) */
  targetRoas?: number;
  /** Target CPA (optional, overrides ROAS) */
  targetCpa?: number;
  /** Min clicks before making a decision (default: 10) */
  minClicks?: number;
  /** Min spend before flagging as negative (default: 20) */
  minSpendForNegative?: number;
  /** ROAS threshold to consider isolating into new ad group (default: 5.0) */
  isolationRoasThreshold?: number;
  /** Min conversions to isolate (default: 3) */
  isolationMinConversions?: number;
  /** Feed title matching config */
  feedTitle?: FeedTitleConfig;
}

export interface TriageReport {
  actionQueue: TriageActionItem[];
  feedTitleUpdates: FeedTitleUpdate[];
  landingPageGaps: LandingPageGap[];
  summary: {
    totalTermsAnalyzed: number;
    addNegative: number;
    isolateNewAdgroup: number;
    isolateNewCampaign: number;
    leaveInBroad: number;
    leaveInPmax: number;
    feedTitleUpdates: number;
    landingPageGaps: number;
    estimatedCostSavings: number;
    estimatedRevenueOpportunity: number;
  };
}

export class TriageEngine {
  private config: Required<Omit<TriageConfig, 'targetCpa' | 'feedTitle'>> & {
    targetCpa?: number;
    feedTitle?: FeedTitleConfig;
  };
  private landingPageAnalyzer: LandingPageAnalyzer;
  private feedTitleMatcher: FeedTitleMatcher;

  constructor(config: TriageConfig = {}) {
    this.config = {
      targetRoas: config.targetRoas ?? 3.0,
      targetCpa: config.targetCpa,
      minClicks: config.minClicks ?? 10,
      minSpendForNegative: config.minSpendForNegative ?? 20,
      isolationRoasThreshold: config.isolationRoasThreshold ?? 5.0,
      isolationMinConversions: config.isolationMinConversions ?? 3,
      feedTitle: config.feedTitle,
    };
    this.landingPageAnalyzer = new LandingPageAnalyzer();
    this.feedTitleMatcher = new FeedTitleMatcher(config.feedTitle);
  }

  triage(records: SearchTermRecord[]): TriageReport {
    const actionQueue: TriageActionItem[] = [];

    for (const r of records) {
      const action = this.decideTriage(r);
      if (action) actionQueue.push(action);
    }

    // Sort by priority then estimated impact
    actionQueue.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return (b.estimatedImpact?.costSavings ?? 0) - (a.estimatedImpact?.costSavings ?? 0);
    });

    const feedTitleUpdates = this.feedTitleMatcher.findUpdates(records);
    const landingPageGaps = this.landingPageAnalyzer.analyze(records);

    // Add feed title actions to queue
    for (const update of feedTitleUpdates) {
      actionQueue.push({
        searchTerm: update.searchTerm,
        action: 'push_feed_title_update',
        priority: 'medium',
        reason: update.reason,
        estimatedImpact: { potentialRevenue: update.conversionValue * 0.2 },
      });
    }

    // Add landing page gap actions to queue
    for (const gap of landingPageGaps) {
      actionQueue.push({
        searchTerm: gap.searchTerm,
        action: 'create_landing_page_gap_note',
        priority: gap.issue === 'no_landing_page' ? 'high' : 'medium',
        reason: gap.suggestedAction,
        estimatedImpact: { potentialRevenue: gap.estimatedImpact },
      });
    }

    const summary = this.buildSummary(actionQueue, feedTitleUpdates, landingPageGaps, records.length);

    return { actionQueue, feedTitleUpdates, landingPageGaps, summary };
  }

  private decideTriage(r: SearchTermRecord): TriageActionItem | null {
    const metrics = calcMetrics(r);
    const isPmax = r.matchType === 'auto' || r.campaign?.toLowerCase().includes('pmax');

    // Not enough data — skip
    if (r.clicks < this.config.minClicks) return null;

    // ── NEGATIVE: Zero conversions + significant spend ──
    if (r.conversions === 0 && r.cost >= this.config.minSpendForNegative) {
      return {
        searchTerm: r.searchTerm,
        action: 'add_negative',
        priority: r.cost >= this.config.minSpendForNegative * 3 ? 'high' : 'medium',
        reason: `$${r.cost.toFixed(2)} spend with zero conversions across ${r.clicks} clicks`,
        estimatedImpact: { costSavings: r.cost },
      };
    }

    // ── NEGATIVE: Very low ROAS with enough data ──
    if (r.conversions > 0 && metrics.roas < this.config.targetRoas * 0.25 && r.cost >= this.config.minSpendForNegative) {
      return {
        searchTerm: r.searchTerm,
        action: 'add_negative',
        priority: 'medium',
        reason: `ROAS ${metrics.roas.toFixed(2)} is <25% of target ${this.config.targetRoas}`,
        estimatedImpact: { costSavings: r.cost * 0.75 },
      };
    }

    // ── ISOLATE: High-performing term deserves its own ad group ──
    if (
      metrics.roas >= this.config.isolationRoasThreshold &&
      r.conversions >= this.config.isolationMinConversions
    ) {
      const tokens = tokenize(r.searchTerm);
      const action: TriageAction = tokens.length >= 4 ? 'isolate_new_campaign' : 'isolate_new_adgroup';
      return {
        searchTerm: r.searchTerm,
        action,
        priority: 'high',
        reason: `ROAS ${metrics.roas.toFixed(2)} with ${r.conversions} conversions — isolate for bid control`,
        suggestedDestination: `[${r.searchTerm}] - Exact Match`,
        estimatedImpact: { potentialRevenue: r.conversionValue * 0.3 },
      };
    }

    // ── LEAVE: Performing within acceptable range ──
    if (metrics.roas >= this.config.targetRoas * 0.5) {
      return {
        searchTerm: r.searchTerm,
        action: isPmax ? 'leave_in_pmax' : 'leave_in_broad',
        priority: 'low',
        reason: `ROAS ${metrics.roas.toFixed(2)} is acceptable — monitor`,
      };
    }

    // ── Marginal: not clearly negative or positive ──
    return {
      searchTerm: r.searchTerm,
      action: isPmax ? 'leave_in_pmax' : 'leave_in_broad',
      priority: 'low',
      reason: `ROAS ${metrics.roas.toFixed(2)} is marginal — watch for trend`,
    };
  }

  private buildSummary(
    actions: TriageActionItem[],
    feedUpdates: FeedTitleUpdate[],
    lpGaps: LandingPageGap[],
    totalTerms: number
  ) {
    const countByAction = (action: TriageAction) => actions.filter(a => a.action === action).length;
    const costSavings = actions
      .filter(a => a.action === 'add_negative')
      .reduce((s, a) => s + (a.estimatedImpact?.costSavings ?? 0), 0);
    const revenueOpp = actions
      .filter(a => a.action.startsWith('isolate'))
      .reduce((s, a) => s + (a.estimatedImpact?.potentialRevenue ?? 0), 0);

    return {
      totalTermsAnalyzed: totalTerms,
      addNegative: countByAction('add_negative'),
      isolateNewAdgroup: countByAction('isolate_new_adgroup'),
      isolateNewCampaign: countByAction('isolate_new_campaign'),
      leaveInBroad: countByAction('leave_in_broad'),
      leaveInPmax: countByAction('leave_in_pmax'),
      feedTitleUpdates: feedUpdates.length,
      landingPageGaps: lpGaps.length,
      estimatedCostSavings: costSavings,
      estimatedRevenueOpportunity: revenueOpp,
    };
  }
}
