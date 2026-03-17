import { SearchTermRecord, IntentCategory, ProfitabilityTier } from '../shared/types';
import { IntentClassifier, IntentClassifierConfig } from './intent-classifier';
import { ProfitabilityAnalyzer, ProfitabilityConfig, ProfitabilityResult } from './profitability-analyzer';
import { QueryClusterer, ClusterConfig, QueryCluster } from './query-cluster';
import { NegativeKeywordFinder, NegativeFinderConfig, NegativeKeywordCandidate } from './negative-keyword-finder';
import { ExpansionFinder, ExpansionConfig, ExpansionOpportunity } from './expansion-finder';

export interface SearchQueryMiningConfig {
  intent?: IntentClassifierConfig;
  profitability?: ProfitabilityConfig;
  clustering?: ClusterConfig;
  negatives?: NegativeFinderConfig;
  expansion?: ExpansionConfig;
}

export interface MiningReport {
  summary: {
    totalTerms: number;
    totalSpend: number;
    totalConversions: number;
    totalWastedSpend: number;
    totalExpansionValue: number;
  };
  intentGroups: Map<IntentCategory, SearchTermRecord[]>;
  profitabilityGroups: Map<ProfitabilityTier, ProfitabilityResult[]>;
  clusters: QueryCluster[];
  negativeKeywordCandidates: NegativeKeywordCandidate[];
  expansionOpportunities: ExpansionOpportunity[];
}

export class SearchQueryMiner {
  private intentClassifier: IntentClassifier;
  private profitabilityAnalyzer: ProfitabilityAnalyzer;
  private clusterer: QueryClusterer;
  private negativeFinder: NegativeKeywordFinder;
  private expansionFinder: ExpansionFinder;

  constructor(config: SearchQueryMiningConfig = {}) {
    this.intentClassifier = new IntentClassifier(config.intent);
    this.profitabilityAnalyzer = new ProfitabilityAnalyzer(config.profitability);
    this.clusterer = new QueryClusterer(config.clustering);
    this.negativeFinder = new NegativeKeywordFinder(config.negatives);
    this.expansionFinder = new ExpansionFinder(config.expansion);
  }

  mine(records: SearchTermRecord[]): MiningReport {
    const intentGroups = this.intentClassifier.classifyBatch(records);
    const profitabilityGroups = this.profitabilityAnalyzer.analyzeBatch(records);
    const clusters = this.clusterer.cluster(records);
    const negativeKeywordCandidates = this.negativeFinder.findCandidates(records);
    const expansionOpportunities = this.expansionFinder.findOpportunities(records);

    const totalSpend = records.reduce((s, r) => s + r.cost, 0);
    const totalConversions = records.reduce((s, r) => s + r.conversions, 0);
    const totalWastedSpend = this.profitabilityAnalyzer.totalWastedSpend(records);
    const totalExpansionValue = expansionOpportunities.reduce((s, o) => s + o.estimatedMonthlyValue, 0);

    return {
      summary: {
        totalTerms: records.length,
        totalSpend,
        totalConversions,
        totalWastedSpend,
        totalExpansionValue,
      },
      intentGroups,
      profitabilityGroups,
      clusters,
      negativeKeywordCandidates,
      expansionOpportunities,
    };
  }
}

export {
  IntentClassifier,
  ProfitabilityAnalyzer,
  QueryClusterer,
  NegativeKeywordFinder,
  ExpansionFinder,
};
export type {
  IntentClassifierConfig,
  ProfitabilityConfig,
  ProfitabilityResult,
  ClusterConfig,
  QueryCluster,
  NegativeFinderConfig,
  NegativeKeywordCandidate,
  ExpansionConfig,
  ExpansionOpportunity,
};
