import { ProfitabilityTier, SearchTermRecord } from '../shared/types';
import { calcMetrics, PerformanceMetrics } from '../shared/metrics';

export interface ProfitabilityConfig {
  /** ROAS threshold above which a term is profitable (default: 3.0) */
  profitableRoasThreshold?: number;
  /** ROAS threshold below which a term is wasteful (default: 1.0) */
  wastefulRoasThreshold?: number;
  /** Minimum spend to evaluate a term (avoids noise from low-data terms) */
  minimumSpend?: number;
  /** Minimum clicks to evaluate (default: 5) */
  minimumClicks?: number;
  /** Target CPA — terms above this are wasteful (optional, overrides ROAS) */
  targetCpa?: number;
}

export interface ProfitabilityResult {
  searchTerm: string;
  tier: ProfitabilityTier;
  metrics: PerformanceMetrics;
  rawData: SearchTermRecord;
  wastedSpend: number;
}

export class ProfitabilityAnalyzer {
  private config: Required<Omit<ProfitabilityConfig, 'targetCpa'>> & { targetCpa?: number };

  constructor(config: ProfitabilityConfig = {}) {
    this.config = {
      profitableRoasThreshold: config.profitableRoasThreshold ?? 3.0,
      wastefulRoasThreshold: config.wastefulRoasThreshold ?? 1.0,
      minimumSpend: config.minimumSpend ?? 0,
      minimumClicks: config.minimumClicks ?? 5,
      targetCpa: config.targetCpa,
    };
  }

  analyze(record: SearchTermRecord): ProfitabilityResult {
    const metrics = calcMetrics(record);
    let tier: ProfitabilityTier = 'marginal';

    const hasEnoughData =
      record.clicks >= this.config.minimumClicks &&
      record.cost >= this.config.minimumSpend;

    if (hasEnoughData) {
      if (this.config.targetCpa !== undefined) {
        if (metrics.cpa <= this.config.targetCpa) tier = 'profitable';
        else if (metrics.cpa > this.config.targetCpa * 2) tier = 'wasteful';
      } else {
        if (metrics.roas >= this.config.profitableRoasThreshold) tier = 'profitable';
        else if (metrics.roas < this.config.wastefulRoasThreshold) tier = 'wasteful';
      }
    }

    const wastedSpend = tier === 'wasteful' ? record.cost : 0;

    return { searchTerm: record.searchTerm, tier, metrics, rawData: record, wastedSpend };
  }

  analyzeBatch(records: SearchTermRecord[]): Map<ProfitabilityTier, ProfitabilityResult[]> {
    const groups = new Map<ProfitabilityTier, ProfitabilityResult[]>();
    for (const record of records) {
      const result = this.analyze(record);
      if (!groups.has(result.tier)) groups.set(result.tier, []);
      groups.get(result.tier)!.push(result);
    }
    return groups;
  }

  totalWastedSpend(records: SearchTermRecord[]): number {
    return records.reduce((sum, r) => sum + this.analyze(r).wastedSpend, 0);
  }
}
