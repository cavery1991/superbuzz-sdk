import { ProductRecord } from '../shared/types';
import { MarginCalculator, MarginConfig, MarginTier, MarginAnalysis } from './margin-calculator';
import { PerformanceScorer, PerformanceConfig, PerformanceTier, PerformanceScore } from './performance-scorer';

export interface SegmentationConfig {
  margin?: MarginConfig;
  performance?: PerformanceConfig;
  /** Max asset groups per campaign (default: 100, Google's limit) */
  maxAssetGroupsPerCampaign?: number;
  /** Max products per asset group (default: no limit) */
  maxProductsPerAssetGroup?: number;
}

export interface AssetGroupRecommendation {
  name: string;
  description: string;
  products: ProductRecord[];
  marginTier: MarginTier;
  performanceTier: PerformanceTier;
  avgRoas: number;
  avgMargin: number;
  totalSpend: number;
  totalRevenue: number;
  suggestedBidStrategy: string;
  suggestedTargetRoas?: number;
}

export interface CampaignRecommendation {
  name: string;
  rationale: string;
  assetGroups: AssetGroupRecommendation[];
  totalProducts: number;
  estimatedMonthlyBudget: number;
}

export interface SegmentationReport {
  campaigns: CampaignRecommendation[];
  unassignedProducts: ProductRecord[];
  insights: string[];
}

export class SegmentationEngine {
  private marginCalc: MarginCalculator;
  private perfScorer: PerformanceScorer;
  private maxAssetGroups: number;
  private maxProductsPerGroup: number;

  constructor(config: SegmentationConfig = {}) {
    this.marginCalc = new MarginCalculator(config.margin);
    this.perfScorer = new PerformanceScorer(config.performance);
    this.maxAssetGroups = config.maxAssetGroupsPerCampaign ?? 100;
    this.maxProductsPerGroup = config.maxProductsPerAssetGroup ?? Infinity;
  }

  segment(products: ProductRecord[]): SegmentationReport {
    const margins = this.marginCalc.analyzeBatch(products);
    const scores = this.perfScorer.scoreBatch(products);

    // Build lookup maps
    const marginMap = new Map<string, MarginAnalysis>();
    for (const m of margins) marginMap.set(m.product.productId, m);
    const scoreMap = new Map<string, PerformanceScore>();
    for (const s of scores) scoreMap.set(s.product.productId, s);

    // Strategy: segment into campaigns by margin tier, then asset groups by performance + category
    const campaigns: CampaignRecommendation[] = [];
    const insights: string[] = [];

    const marginGroups = this.groupBy(margins, m => m.tier);

    for (const [marginTier, marginProducts] of marginGroups) {
      const perfGroups = this.groupBy(
        marginProducts.map(m => ({
          margin: m,
          perf: scoreMap.get(m.product.productId)!,
        })),
        item => item.perf.tier
      );

      const assetGroups: AssetGroupRecommendation[] = [];

      for (const [perfTier, items] of perfGroups) {
        // Further split by category if too many products
        const categoryGroups = this.groupBy(items, i => i.margin.product.category || 'uncategorized');

        for (const [category, catItems] of categoryGroups) {
          const prods = catItems.map(i => i.margin.product);
          const avgMargin = catItems.reduce((s, i) => s + i.margin.marginPercent, 0) / catItems.length;
          const avgRoas = catItems.reduce((s, i) => s + i.perf.roas, 0) / catItems.length;
          const totalSpend = prods.reduce((s, p) => s + p.cost, 0);
          const totalRevenue = prods.reduce((s, p) => s + p.conversionValue, 0);

          const { bidStrategy, targetRoas } = this.suggestBidStrategy(marginTier, perfTier, avgMargin);

          assetGroups.push({
            name: `${marginTier} | ${perfTier} | ${category}`,
            description: `${prods.length} products, ${marginTier} margin, ${perfTier} performance`,
            products: prods,
            marginTier,
            performanceTier: perfTier,
            avgRoas,
            avgMargin,
            totalSpend,
            totalRevenue,
            suggestedBidStrategy: bidStrategy,
            suggestedTargetRoas: targetRoas,
          });
        }
      }

      if (assetGroups.length > 0) {
        const totalProducts = assetGroups.reduce((s, ag) => s + ag.products.length, 0);
        const totalBudget = assetGroups.reduce((s, ag) => s + ag.totalSpend, 0);

        campaigns.push({
          name: `PMax – ${marginTier}`,
          rationale: this.getCampaignRationale(marginTier),
          assetGroups: assetGroups.slice(0, this.maxAssetGroups),
          totalProducts,
          estimatedMonthlyBudget: totalBudget,
        });
      }
    }

    // Generate insights
    const heroes = scores.filter(s => s.tier === 'hero');
    const zombies = scores.filter(s => s.tier === 'zombie');
    const underperformers = scores.filter(s => s.tier === 'underperformer');

    if (heroes.length > 0) {
      insights.push(`${heroes.length} hero products driving ${heroes.reduce((s, h) => s + h.product.conversionValue, 0).toFixed(2)} in revenue — protect their budget allocation.`);
    }
    if (zombies.length > 0) {
      insights.push(`${zombies.length} zombie products with <${this.perfScorer['config'].zombieImpressions} impressions — consider feed optimization or exclusion.`);
    }
    if (underperformers.length > 0) {
      const wastedSpend = underperformers.reduce((s, u) => s + u.product.cost, 0);
      insights.push(`${underperformers.length} underperformers wasting $${wastedSpend.toFixed(2)} — isolate into separate campaign with lower bids or exclude.`);
    }

    return { campaigns, unassignedProducts: [], insights };
  }

  private suggestBidStrategy(
    marginTier: MarginTier,
    perfTier: PerformanceTier,
    avgMargin: number
  ): { bidStrategy: string; targetRoas?: number } {
    if (perfTier === 'hero') {
      const targetRoas = avgMargin > 0 ? Math.max(100 / avgMargin * 1.2, 2.0) : 3.0;
      return { bidStrategy: 'Maximize conversion value (tROAS)', targetRoas };
    }
    if (perfTier === 'zombie' || perfTier === 'new') {
      return { bidStrategy: 'Maximize clicks (discovery phase)' };
    }
    if (perfTier === 'underperformer') {
      return { bidStrategy: 'Maximize conversion value (high tROAS to limit spend)', targetRoas: avgMargin > 0 ? 100 / avgMargin * 2 : 8.0 };
    }
    // Solid
    const targetRoas = avgMargin > 0 ? 100 / avgMargin * 1.5 : 4.0;
    return { bidStrategy: 'Maximize conversion value (tROAS)', targetRoas };
  }

  private getCampaignRationale(marginTier: MarginTier): string {
    switch (marginTier) {
      case 'high-margin':
        return 'High-margin products can tolerate lower ROAS while remaining profitable. Bid aggressively to capture volume.';
      case 'mid-margin':
        return 'Mid-margin products need balanced bidding. Set moderate tROAS targets aligned with break-even.';
      case 'low-margin':
        return 'Low-margin products need tight ROAS control. High tROAS targets to prevent unprofitable spend.';
      case 'negative-margin':
        return 'Negative-margin products should only run if driving LTV or strategic market share. Consider excluding.';
    }
  }

  private groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return groups;
  }
}
