import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPriceBenchmarks,
  priceCompetitiveness,
  priceFeature,
  OVERALL_KEY,
} from '../src/pricing/price-intel.js';

// Category 1: prices 10,20,30,40,50 -> median 30, p25 20, p75 40.
function seed() {
  return [
    { id: 'a', categoryId: 1, price: 10 },
    { id: 'b', categoryId: 1, price: 20 },
    { id: 'c', categoryId: 1, price: 30 },
    { id: 'd', categoryId: 1, price: 40 },
    { id: 'e', categoryId: 1, price: 50 },
    { id: 'f', categoryId: 2, price: 100 },
    { id: 'g', categoryId: 2, price: 200 },
    // ignored: null and zero prices.
    { id: 'h', categoryId: 1, price: null },
    { id: 'i', categoryId: 1, price: 0 },
  ];
}

test('benchmark median/percentile correctness on a small set', () => {
  const b = buildPriceBenchmarks(seed());
  const cat1 = b.get(1);
  assert.equal(cat1.count, 5); // null and zero prices ignored
  assert.equal(cat1.min, 10);
  assert.equal(cat1.p25, 20);
  assert.equal(cat1.median, 30);
  assert.equal(cat1.p75, 40);
  assert.equal(cat1.max, 50);
  assert.equal(cat1.mean, 30);

  // Percentile rank within the category, 0 = cheapest.
  assert.equal(priceCompetitiveness({ categoryId: 1, price: 10 }, b).percentile, 0);
  assert.equal(priceCompetitiveness({ categoryId: 1, price: 30 }, b).percentile, 0.5);
  assert.equal(priceCompetitiveness({ categoryId: 1, price: 50 }, b).percentile, 1);

  // Overall fallback benchmark includes all priced products.
  assert.equal(b.get(OVERALL_KEY).count, 7);
});

test('underpriced product classified below with score ~1', () => {
  const b = buildPriceBenchmarks(seed());
  const r = priceCompetitiveness({ categoryId: 1, price: 12 }, b); // median 30
  assert.equal(r.position, 'below');
  assert.equal(r.penalty, 0);
  assert.equal(r.score, 1);
  assert.ok(r.ratioToMedian < 0.9);
});

test('overpriced product classified above with penalty > 0', () => {
  const b = buildPriceBenchmarks(seed());
  const r = priceCompetitiveness({ categoryId: 1, price: 60 }, b); // 2x median 30
  assert.equal(r.position, 'above');
  assert.ok(r.penalty > 0);
  assert.ok(r.score < 1);
  assert.equal(r.score, 1 - r.penalty);
  // priceFeature reuses the same score.
  assert.equal(priceFeature({ categoryId: 1, price: 60 }, b), r.score);
});

test('competitive product within +/-10% of median', () => {
  const b = buildPriceBenchmarks(seed());
  const r = priceCompetitiveness({ categoryId: 1, price: 31 }, b); // median 30
  assert.equal(r.position, 'competitive');
  assert.equal(r.penalty, 0);
  assert.equal(r.score, 1);
});

test('fallback to overall benchmark for an unseen category', () => {
  const b = buildPriceBenchmarks(seed());
  // Category 99 was never seen; should use the overall benchmark.
  const r = priceCompetitiveness({ categoryId: 99, price: 1000 }, b);
  assert.equal(r.hasBenchmark, true);
  assert.equal(r.marketMedian, b.get(OVERALL_KEY).median);
  assert.equal(r.position, 'above'); // 1000 is well above the catalog median
  assert.ok(r.penalty > 0);
});

test('no price or no benchmark yields unknown/neutral', () => {
  const b = buildPriceBenchmarks(seed());
  const noPrice = priceCompetitiveness({ categoryId: 1, price: null }, b);
  assert.equal(noPrice.position, 'unknown');
  assert.equal(noPrice.percentile, null);
  assert.equal(noPrice.score, 1); // neutral feature

  const empty = buildPriceBenchmarks([]);
  const noBench = priceCompetitiveness({ categoryId: 1, price: 50 }, empty);
  assert.equal(noBench.hasBenchmark, false);
  assert.equal(noBench.position, 'unknown');
  assert.equal(priceFeature({ categoryId: 1, price: 50 }, empty), 1);
});
