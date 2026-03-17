import { SearchTermRecord } from '../shared/types';
import { tokenize } from '../shared/tokenizer';

export interface LandingPageGap {
  searchTerm: string;
  currentLandingPage?: string;
  issue: 'no_landing_page' | 'low_relevance' | 'high_bounce_potential';
  suggestedAction: string;
  estimatedImpact: number; // conversion value at risk
}

export class LandingPageAnalyzer {
  /**
   * Detect gaps between search terms and their landing pages.
   * A gap exists when:
   * - No landing page is assigned
   * - Landing page URL doesn't contain any tokens from the search term (proxy for relevance)
   * - High-value term with potential mismatch
   */
  analyze(records: SearchTermRecord[]): LandingPageGap[] {
    const gaps: LandingPageGap[] = [];

    for (const r of records) {
      if (!r.landingPage) {
        if (r.clicks > 0) {
          gaps.push({
            searchTerm: r.searchTerm,
            issue: 'no_landing_page',
            suggestedAction: `Create dedicated landing page for "${r.searchTerm}"`,
            estimatedImpact: r.conversionValue > 0 ? r.conversionValue * 1.5 : r.cost,
          });
        }
        continue;
      }

      const termTokens = tokenize(r.searchTerm);
      const pageTokens = new Set(tokenize(r.landingPage.replace(/https?:\/\//, '').replace(/[/\-_.?&=]/g, ' ')));

      const matchingTokens = termTokens.filter(t => t.length > 2 && pageTokens.has(t));
      const relevanceScore = termTokens.length > 0 ? matchingTokens.length / termTokens.length : 0;

      if (relevanceScore < 0.3 && r.clicks >= 5) {
        gaps.push({
          searchTerm: r.searchTerm,
          currentLandingPage: r.landingPage,
          issue: 'low_relevance',
          suggestedAction: `Landing page "${r.landingPage}" may not match intent of "${r.searchTerm}" — review or create better match`,
          estimatedImpact: r.conversionValue > 0 ? r.conversionValue * 0.3 : r.cost * 0.5,
        });
      }
    }

    return gaps.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }
}
