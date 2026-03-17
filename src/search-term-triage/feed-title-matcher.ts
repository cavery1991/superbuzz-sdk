import { SearchTermRecord } from '../shared/types';
import { tokenize } from '../shared/tokenizer';

export interface FeedTitleUpdate {
  searchTerm: string;
  missingTokens: string[];
  suggestedTitleAddition: string;
  reason: string;
  impressions: number;
  conversionValue: number;
}

export interface FeedTitleConfig {
  /** Current product feed titles to compare against */
  feedTitles?: string[];
  /** Min impressions for a term to trigger feed update (default: 50) */
  minImpressions?: number;
  /** Min conversions for a term to trigger feed update (default: 1) */
  minConversions?: number;
}

export class FeedTitleMatcher {
  private feedTokens: Set<string>;
  private minImpressions: number;
  private minConversions: number;

  constructor(config: FeedTitleConfig = {}) {
    this.feedTokens = new Set(
      (config.feedTitles ?? []).flatMap(t => tokenize(t))
    );
    this.minImpressions = config.minImpressions ?? 50;
    this.minConversions = config.minConversions ?? 1;
  }

  findUpdates(records: SearchTermRecord[]): FeedTitleUpdate[] {
    const updates: FeedTitleUpdate[] = [];

    for (const r of records) {
      if (r.impressions < this.minImpressions) continue;
      if (r.conversions < this.minConversions) continue;

      const termTokens = tokenize(r.searchTerm);
      const missingTokens = termTokens.filter(
        t => t.length > 2 && !this.feedTokens.has(t)
      );

      if (missingTokens.length > 0) {
        updates.push({
          searchTerm: r.searchTerm,
          missingTokens,
          suggestedTitleAddition: missingTokens.join(', '),
          reason: `Converting term "${r.searchTerm}" uses tokens not in feed titles: ${missingTokens.join(', ')}`,
          impressions: r.impressions,
          conversionValue: r.conversionValue,
        });
      }
    }

    return updates.sort((a, b) => b.conversionValue - a.conversionValue);
  }
}
