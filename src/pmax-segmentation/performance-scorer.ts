import { ProductRecord } from '../shared/types';
import { calcMetrics } from '../shared/metrics';

export type PerformanceTier = 'hero' | 'solid' | 'underperformer' | 'zombie' | 'new';

export interface PerformanceConfig {
  /** Min conversions for hero status (default: 10) */
  heroConversions?: number;
  /** Min ROAS for hero status (default: 4.0) */
  heroRoas?: number;
  /** Min clicks to have enough data (default: 20) */
  minClicks?: number;
  /** Max ROAS for underperformer (default: 1.0) */
  underperformerRoas?: number;
  /** Max impressions for zombie (default: 50) */
  zombieImpressions?: number;
}

export interface PerformanceScore {
  product: ProductRecord;
  tier: PerformanceTier;
  roas: number;
  conversionRate: number;
  score: number; // 0-100 composite
}

export class PerformanceScorer {
  private config: Required<PerformanceConfig>;

  constructor(config: PerformanceConfig = {}) {
    this.config = {
      heroConversions: config.heroConversions ?? 10,
      heroRoas: config.heroRoas ?? 4.0,
      minClicks: config.minClicks ?? 20,
      underperformerRoas: config.underperformerRoas ?? 1.0,
      zombieImpressions: config.zombieImpressions ?? 50,
    };
  }

  score(product: ProductRecord): PerformanceScore {
    const metrics = calcMetrics(product);

    // Zombie: barely any impressions
    if (product.impressions < this.config.zombieImpressions) {
      return { product, tier: 'zombie', roas: metrics.roas, conversionRate: metrics.conversionRate, score: 0 };
    }

    // New: not enough clicks to evaluate
    if (product.clicks < this.config.minClicks) {
      return { product, tier: 'new', roas: metrics.roas, conversionRate: metrics.conversionRate, score: 25 };
    }

    // Hero: high conversions + high ROAS
    if (product.conversions >= this.config.heroConversions && metrics.roas >= this.config.heroRoas) {
      const score = Math.min(100, 70 + (metrics.roas / this.config.heroRoas) * 15 + (product.conversions / this.config.heroConversions) * 15);
      return { product, tier: 'hero', roas: metrics.roas, conversionRate: metrics.conversionRate, score };
    }

    // Underperformer: low ROAS with enough data
    if (metrics.roas < this.config.underperformerRoas) {
      const score = Math.max(5, 30 * metrics.roas);
      return { product, tier: 'underperformer', roas: metrics.roas, conversionRate: metrics.conversionRate, score };
    }

    // Solid: everything else with reasonable performance
    const score = 40 + Math.min(30, (metrics.roas / this.config.heroRoas) * 30);
    return { product, tier: 'solid', roas: metrics.roas, conversionRate: metrics.conversionRate, score };
  }

  scoreBatch(products: ProductRecord[]): PerformanceScore[] {
    return products.map(p => this.score(p)).sort((a, b) => b.score - a.score);
  }
}
