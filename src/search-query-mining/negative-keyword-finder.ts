import { SearchTermRecord } from '../shared/types';
import { tokenize } from '../shared/tokenizer';
import { calcMetrics } from '../shared/metrics';

export interface NegativeKeywordCandidate {
  keyword: string;
  matchType: 'exact' | 'phrase';
  reason: string;
  affectedTerms: string[];
  totalWastedSpend: number;
  totalImpressions: number;
  totalClicks: number;
}

export interface NegativeFinderConfig {
  /** Max ROAS to flag as negative candidate (default: 0.5) */
  roasThreshold?: number;
  /** Min spend to consider (default: 10) */
  minSpend?: number;
  /** Min impressions with zero conversions to flag (default: 100) */
  zeroConversionImpressionThreshold?: number;
  /** Min clicks with zero conversions to flag (default: 10) */
  zeroConversionClickThreshold?: number;
}

export class NegativeKeywordFinder {
  private config: Required<NegativeFinderConfig>;

  constructor(config: NegativeFinderConfig = {}) {
    this.config = {
      roasThreshold: config.roasThreshold ?? 0.5,
      minSpend: config.minSpend ?? 10,
      zeroConversionImpressionThreshold: config.zeroConversionImpressionThreshold ?? 100,
      zeroConversionClickThreshold: config.zeroConversionClickThreshold ?? 10,
    };
  }

  findCandidates(records: SearchTermRecord[]): NegativeKeywordCandidate[] {
    const candidates: NegativeKeywordCandidate[] = [];

    // 1. Individual wasteful terms → exact match negatives
    for (const r of records) {
      if (r.cost < this.config.minSpend) continue;
      const metrics = calcMetrics(r);

      const isZeroConverter =
        r.conversions === 0 &&
        r.impressions >= this.config.zeroConversionImpressionThreshold &&
        r.clicks >= this.config.zeroConversionClickThreshold;

      const isLowRoas =
        metrics.roas < this.config.roasThreshold && r.conversions > 0;

      if (isZeroConverter || isLowRoas) {
        candidates.push({
          keyword: r.searchTerm,
          matchType: 'exact',
          reason: isZeroConverter
            ? `${r.clicks} clicks, $${r.cost.toFixed(2)} spend, zero conversions`
            : `ROAS ${metrics.roas.toFixed(2)} below threshold ${this.config.roasThreshold}`,
          affectedTerms: [r.searchTerm],
          totalWastedSpend: r.cost,
          totalImpressions: r.impressions,
          totalClicks: r.clicks,
        });
      }
    }

    // 2. Token-level analysis → phrase match negatives
    const tokenStats = new Map<string, { terms: SearchTermRecord[]; totalCost: number; totalConversions: number }>();
    for (const r of records) {
      for (const token of tokenize(r.searchTerm)) {
        if (token.length < 3) continue;
        if (!tokenStats.has(token)) {
          tokenStats.set(token, { terms: [], totalCost: 0, totalConversions: 0 });
        }
        const stat = tokenStats.get(token)!;
        stat.terms.push(r);
        stat.totalCost += r.cost;
        stat.totalConversions += r.conversions;
      }
    }

    for (const [token, stat] of tokenStats) {
      if (stat.terms.length < 2) continue;
      if (stat.totalCost < this.config.minSpend * 2) continue;
      if (stat.totalConversions === 0) {
        candidates.push({
          keyword: token,
          matchType: 'phrase',
          reason: `Token "${token}" appears in ${stat.terms.length} terms with $${stat.totalCost.toFixed(2)} total spend and zero conversions`,
          affectedTerms: stat.terms.map(t => t.searchTerm),
          totalWastedSpend: stat.totalCost,
          totalImpressions: stat.terms.reduce((s, t) => s + t.impressions, 0),
          totalClicks: stat.terms.reduce((s, t) => s + t.clicks, 0),
        });
      }
    }

    // Sort by wasted spend descending
    return candidates.sort((a, b) => b.totalWastedSpend - a.totalWastedSpend);
  }
}
