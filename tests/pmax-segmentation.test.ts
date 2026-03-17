import { MarginCalculator, PerformanceScorer, SegmentationEngine } from '../src/pmax-segmentation';
import { ProductRecord } from '../src/shared/types';

function makeProduct(overrides: Partial<ProductRecord> & { productId: string }): ProductRecord {
  return {
    title: 'Test Product',
    category: 'General',
    price: 100,
    costOfGoods: 50,
    impressions: 1000,
    clicks: 50,
    cost: 100,
    conversions: 5,
    conversionValue: 500,
    ...overrides,
  };
}

describe('MarginCalculator', () => {
  const calc = new MarginCalculator({ highMarginThreshold: 50, midMarginThreshold: 25 });

  it('calculates high-margin products', () => {
    const result = calc.analyze(makeProduct({ productId: 'p1', price: 100, costOfGoods: 30 }));
    expect(result.tier).toBe('high-margin');
    expect(result.marginPercent).toBe(70);
    expect(result.breakEvenRoas).toBeCloseTo(100 / 70, 1);
  });

  it('calculates mid-margin products', () => {
    const result = calc.analyze(makeProduct({ productId: 'p2', price: 100, costOfGoods: 65 }));
    expect(result.tier).toBe('mid-margin');
    expect(result.marginPercent).toBe(35);
  });

  it('calculates low-margin products', () => {
    const result = calc.analyze(makeProduct({ productId: 'p3', price: 100, costOfGoods: 85 }));
    expect(result.tier).toBe('low-margin');
    expect(result.marginPercent).toBe(15);
  });

  it('handles negative-margin products', () => {
    const result = calc.analyze(makeProduct({ productId: 'p4', price: 100, costOfGoods: 110 }));
    expect(result.tier).toBe('negative-margin');
    expect(result.breakEvenRoas).toBe(Infinity);
  });

  it('uses grossMargin when provided', () => {
    const result = calc.analyze(makeProduct({ productId: 'p5', grossMargin: 60, costOfGoods: undefined }));
    expect(result.tier).toBe('high-margin');
    expect(result.marginPercent).toBe(60);
  });
});

describe('PerformanceScorer', () => {
  const scorer = new PerformanceScorer();

  it('identifies hero products', () => {
    const result = scorer.score(makeProduct({
      productId: 'hero1',
      conversions: 15,
      conversionValue: 1500,
      cost: 200,
      clicks: 50,
      impressions: 1000,
    }));
    expect(result.tier).toBe('hero');
    expect(result.score).toBeGreaterThan(70);
  });

  it('identifies zombie products', () => {
    const result = scorer.score(makeProduct({
      productId: 'zombie1',
      impressions: 10,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversionValue: 0,
    }));
    expect(result.tier).toBe('zombie');
    expect(result.score).toBe(0);
  });

  it('identifies underperformers', () => {
    const result = scorer.score(makeProduct({
      productId: 'under1',
      impressions: 500,
      clicks: 40,
      cost: 200,
      conversions: 1,
      conversionValue: 50,
    }));
    expect(result.tier).toBe('underperformer');
  });

  it('identifies new products with insufficient data', () => {
    const result = scorer.score(makeProduct({
      productId: 'new1',
      impressions: 100,
      clicks: 5,
      cost: 10,
      conversions: 0,
      conversionValue: 0,
    }));
    expect(result.tier).toBe('new');
  });

  it('scores batch and sorts by score descending', () => {
    const products = [
      makeProduct({ productId: 'low', impressions: 500, clicks: 40, cost: 200, conversions: 1, conversionValue: 50 }),
      makeProduct({ productId: 'high', conversions: 15, conversionValue: 1500, cost: 200, clicks: 50, impressions: 1000 }),
    ];
    const scores = scorer.scoreBatch(products);
    expect(scores[0].product.productId).toBe('high');
  });
});

describe('SegmentationEngine', () => {
  const engine = new SegmentationEngine();

  it('produces segmented campaigns by margin tier', () => {
    const products = [
      makeProduct({ productId: 'hm1', price: 100, costOfGoods: 30, category: 'Shoes', conversions: 12, conversionValue: 1200, cost: 150, clicks: 60, impressions: 2000 }),
      makeProduct({ productId: 'hm2', price: 80, costOfGoods: 20, category: 'Shoes', conversions: 8, conversionValue: 800, cost: 100, clicks: 40, impressions: 1500 }),
      makeProduct({ productId: 'lm1', price: 50, costOfGoods: 45, category: 'Accessories', conversions: 3, conversionValue: 150, cost: 80, clicks: 30, impressions: 1000 }),
      makeProduct({ productId: 'z1', price: 25, costOfGoods: 10, category: 'Widgets', impressions: 20, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 }),
    ];

    const report = engine.segment(products);

    expect(report.campaigns.length).toBeGreaterThan(0);
    expect(report.insights.length).toBeGreaterThan(0);

    // Should have campaign for high-margin products
    const highMarginCampaign = report.campaigns.find(c => c.name.includes('high-margin'));
    expect(highMarginCampaign).toBeDefined();
    expect(highMarginCampaign!.totalProducts).toBeGreaterThan(0);
  });

  it('generates meaningful insights', () => {
    const products = [
      makeProduct({ productId: 'hero', conversions: 15, conversionValue: 1500, cost: 200, clicks: 50, impressions: 2000, price: 100, costOfGoods: 40 }),
      makeProduct({ productId: 'zombie', impressions: 20, clicks: 0, cost: 0, conversions: 0, conversionValue: 0, price: 50, costOfGoods: 30 }),
    ];
    const report = engine.segment(products);
    expect(report.insights.some(i => i.includes('hero'))).toBe(true);
    expect(report.insights.some(i => i.includes('zombie'))).toBe(true);
  });

  it('suggests appropriate bid strategies', () => {
    const products = [
      makeProduct({ productId: 'h1', price: 100, costOfGoods: 30, conversions: 20, conversionValue: 2000, cost: 300, clicks: 80, impressions: 3000, category: 'A' }),
    ];
    const report = engine.segment(products);
    const assetGroup = report.campaigns[0]?.assetGroups[0];
    expect(assetGroup).toBeDefined();
    expect(assetGroup!.suggestedBidStrategy).toContain('tROAS');
  });
});
