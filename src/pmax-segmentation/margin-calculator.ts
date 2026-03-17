import { ProductRecord } from '../shared/types';

export type MarginTier = 'high-margin' | 'mid-margin' | 'low-margin' | 'negative-margin';

export interface MarginConfig {
  /** Margin % above which product is high-margin (default: 50) */
  highMarginThreshold?: number;
  /** Margin % above which product is mid-margin (default: 25) */
  midMarginThreshold?: number;
}

export interface MarginAnalysis {
  product: ProductRecord;
  marginPercent: number;
  tier: MarginTier;
  breakEvenRoas: number;
}

export class MarginCalculator {
  private highThreshold: number;
  private midThreshold: number;

  constructor(config: MarginConfig = {}) {
    this.highThreshold = config.highMarginThreshold ?? 50;
    this.midThreshold = config.midMarginThreshold ?? 25;
  }

  analyze(product: ProductRecord): MarginAnalysis {
    const marginPercent = product.grossMargin ??
      (product.costOfGoods !== undefined
        ? ((product.price - product.costOfGoods) / product.price) * 100
        : 0);

    let tier: MarginTier;
    if (marginPercent >= this.highThreshold) tier = 'high-margin';
    else if (marginPercent >= this.midThreshold) tier = 'mid-margin';
    else if (marginPercent > 0) tier = 'low-margin';
    else tier = 'negative-margin';

    // Break-even ROAS = 1 / (margin% / 100). E.g. 50% margin → 2.0 ROAS
    const breakEvenRoas = marginPercent > 0 ? 100 / marginPercent : Infinity;

    return { product, marginPercent, tier, breakEvenRoas };
  }

  analyzeBatch(products: ProductRecord[]): MarginAnalysis[] {
    return products.map(p => this.analyze(p));
  }
}
