import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectedRevenue, estimateOpportunities, summarizeRevenue } from '../src/revenue/attribution.js';

test('projectedRevenue uses observed conversion rate when clicks+conversions present', () => {
  // clicks=100, conversions=5 => observed convRate = 0.05 (not the 0.02 default)
  // incrementalClicks = 100 * 0.3 = 30; revenue = 30 * 0.05 * 80 = 120
  const rev = projectedRevenue({ clicks: 100, conversions: 5, avgOrderValue: 80, positionLift: 0.3 });
  assert.equal(rev, 120);
});

test('projectedRevenue falls back to default convRate from impressions+ctr', () => {
  // no clicks => incrementalClicks = impressions*ctr*positionLift = 10000*0.01*0.3 = 30
  // convRate falls back to default 0.02 => revenue = 30 * 0.02 * 80 = 48
  const rev = projectedRevenue({ impressions: 10000, ctr: 0.01, positionLift: 0.3, conversionRate: 0.02, avgOrderValue: 80 });
  assert.equal(rev, 48);
});

test('projectedRevenue rounds to cents and defaults to zero with no traffic', () => {
  assert.equal(projectedRevenue({}), 0);
  // impressions=333, ctr=0.01, lift=0.3 => 0.999 clicks; *0.02*80 = 1.5984 -> 1.6
  assert.equal(projectedRevenue({ impressions: 333 }), 1.6);
});

test('estimateOpportunities sorts by revenue and zeroes out non-fixable', () => {
  const opps = [
    { query: 'small', clicks: 10, conversions: 1 },          // 10*0.3 * 0.1 * 80 = 24
    { query: 'big', clicks: 100, conversions: 10 },          // 100*0.3 * 0.1 * 80 = 240
    { query: 'skipme', clicks: 1000, conversions: 100, wouldFix: false }, // forced 0
  ];
  const out = estimateOpportunities(opps, { avgOrderValue: 80, positionLift: 0.3 });

  // input not mutated
  assert.equal(opps[0].projectedRevenue, undefined);

  // sorted descending by projectedRevenue
  assert.deepEqual(out.map((o) => o.query), ['big', 'small', 'skipme']);
  assert.equal(out[0].projectedRevenue, 240);
  assert.equal(out[1].projectedRevenue, 24);

  // non-fixable zeroed regardless of strong metrics
  assert.equal(out[2].projectedRevenue, 0);
});

test('estimateOpportunities handles empty/undefined input', () => {
  assert.deepEqual(estimateOpportunities(undefined), []);
  assert.deepEqual(estimateOpportunities([]), []);
});

test('summarizeRevenue totals correctly (annual = 12x monthly) and returns top 5', () => {
  const estimated = estimateOpportunities(
    [
      { query: 'a', clicks: 100, conversions: 10 }, // 240
      { query: 'b', clicks: 10, conversions: 1 },   // 24
      { query: 'c', clicks: 50, conversions: 5 },   // 120
      { query: 'd', clicks: 20, conversions: 2 },   // 48
      { query: 'e', clicks: 5, conversions: 1 },    // 5*0.3*0.2*80 = 24
      { query: 'f', clicks: 1, conversions: 0 },    // default convRate: 1*0.3*0.02*80 = 0.48
    ],
    { avgOrderValue: 80, positionLift: 0.3 },
  );

  const sum = summarizeRevenue(estimated);
  const expectedMonthly = 240 + 24 + 120 + 48 + 24 + 0.48;
  assert.equal(sum.totalMonthly, Math.round(expectedMonthly * 100) / 100);
  assert.equal(sum.totalAnnual, Math.round(expectedMonthly * 12 * 100) / 100);
  assert.equal(sum.totalAnnual, sum.totalMonthly * 12);

  // top is capped at 5, highest first
  assert.equal(sum.top.length, 5);
  assert.equal(sum.top[0].query, 'a');
  assert.equal(sum.top[0].projectedRevenue, 240);
  assert.deepEqual(Object.keys(sum.top[0]).sort(), ['projectedRevenue', 'query']);
});

test('summarizeRevenue handles empty input', () => {
  assert.deepEqual(summarizeRevenue([]), { totalMonthly: 0, totalAnnual: 0, top: [] });
});
