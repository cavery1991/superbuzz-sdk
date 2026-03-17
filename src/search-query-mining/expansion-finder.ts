import { SearchTermRecord } from '../shared/types';
import { calcMetrics } from '../shared/metrics';
import { tokenize } from '../shared/tokenizer';

export interface ExpansionOpportunity {
  searchTerm: string;
  reason: string;
  suggestedAction: 'add_as_exact_keyword' | 'create_new_adgroup' | 'add_to_existing_adgroup';
  metrics: {
    roas: number;
    conversions: number;
    conversionRate: number;
    cpa: number;
  };
  estimatedMonthlyValue: number;
}

export interface ExpansionConfig {
  /** Minimum ROAS to qualify as expansion candidate (default: 2.0) */
  minRoas?: number;
  /** Minimum conversions (default: 2) */
  minConversions?: number;
  /** Minimum clicks (default: 10) */
  minClicks?: number;
  /** Existing exact match keywords to exclude from suggestions */
  existingExactKeywords?: string[];
}

export class ExpansionFinder {
  private config: Required<Omit<ExpansionConfig, 'existingExactKeywords'>> & { existingExactKeywords: Set<string> };

  constructor(config: ExpansionConfig = {}) {
    this.config = {
      minRoas: config.minRoas ?? 2.0,
      minConversions: config.minConversions ?? 2,
      minClicks: config.minClicks ?? 10,
      existingExactKeywords: new Set(
        (config.existingExactKeywords ?? []).map(k => k.toLowerCase())
      ),
    };
  }

  findOpportunities(records: SearchTermRecord[]): ExpansionOpportunity[] {
    const opportunities: ExpansionOpportunity[] = [];

    for (const r of records) {
      if (r.clicks < this.config.minClicks) continue;
      if (r.conversions < this.config.minConversions) continue;

      const metrics = calcMetrics(r);
      if (metrics.roas < this.config.minRoas) continue;

      const termLower = r.searchTerm.toLowerCase();
      if (this.config.existingExactKeywords.has(termLower)) continue;

      const tokens = tokenize(termLower);
      const suggestedAction = tokens.length >= 4
        ? 'create_new_adgroup'
        : 'add_as_exact_keyword';

      opportunities.push({
        searchTerm: r.searchTerm,
        reason: `ROAS ${metrics.roas.toFixed(2)}, ${r.conversions} conversions at $${metrics.cpa.toFixed(2)} CPA`,
        suggestedAction,
        metrics: {
          roas: metrics.roas,
          conversions: r.conversions,
          conversionRate: metrics.conversionRate,
          cpa: metrics.cpa,
        },
        estimatedMonthlyValue: r.conversionValue,
      });
    }

    // Sort by estimated value descending
    return opportunities.sort((a, b) => b.estimatedMonthlyValue - a.estimatedMonthlyValue);
  }
}
