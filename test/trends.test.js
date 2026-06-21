/**
 * Tests for the demand trends & seasonality module.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ingestTrends,
  demandMultiplier,
  applyDemandToUniverse,
  risingOpportunities,
} from '../src/demand/trends.js';

test('ingestTrends from an array normalizes and defaults missing fields', () => {
  const out = ingestTrends([
    { query: '  Wool Coat ', trend: 'rising', growth: 0.4, seasonalMonths: [11, 12] },
    { query: 'plain tee' }, // all optional fields missing
    { query: 'old gadget', trend: 'declining', growth: -0.3 },
    { query: '' }, // dropped (no query)
  ]);

  assert.equal(out.length, 3);
  assert.deepEqual(out[0], {
    query: 'wool coat',
    trend: 'rising',
    growth: 0.4,
    seasonalMonths: [11, 12],
  });
  assert.deepEqual(out[1], {
    query: 'plain tee',
    trend: 'flat',
    growth: 0,
    seasonalMonths: [],
  });
  assert.equal(out[2].trend, 'declining');
  assert.equal(out[2].growth, -0.3);
});

test('ingestTrends from a CSV string normalizes months and fields', () => {
  const csv = [
    'query,trend,growth,seasonal_months',
    'Wool Coat,rising,0.4,Nov|Dec',
    'Sandals,rising,0.2,6 7 8',
    'flip phone,declining,-0.5,',
  ].join('\n');

  const out = ingestTrends(csv);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], {
    query: 'wool coat',
    trend: 'rising',
    growth: 0.4,
    seasonalMonths: [11, 12],
  });
  assert.deepEqual(out[1].seasonalMonths, [6, 7, 8]);
  assert.equal(out[2].trend, 'declining');
  assert.deepEqual(out[2].seasonalMonths, []);
});

test('demandMultiplier boosts rising and boosts further when in-season', () => {
  const row = { trend: 'rising', growth: 0.4, seasonalMonths: [12] };

  // No month: rising only -> 1 + 0.4 = 1.4
  assert.equal(demandMultiplier(row, {}), 1.4);
  // Out of season -> still 1.4
  assert.equal(demandMultiplier(row, { month: 6 }), 1.4);
  // In season -> 1.4 * 1.5 = 2.1
  assert.ok(Math.abs(demandMultiplier(row, { month: 12 }) - 2.1) < 1e-9);

  // Missing trendRow -> 1.0
  assert.equal(demandMultiplier(null, { month: 12 }), 1.0);

  // Declining floors at 0.5
  assert.equal(demandMultiplier({ trend: 'declining', growth: -0.9 }, {}), 0.5);
  assert.equal(demandMultiplier({ trend: 'declining', growth: -0.3 }, {}), 0.7);
});

test('applyDemandToUniverse scales matching entries and leaves others unchanged', () => {
  const universe = [
    { query: 'wool coat', value: 100, source: 'real', categoryId: 1 },
    { query: 'plain tee', value: 50, source: 'generated', categoryId: 2 },
  ];
  const trends = ingestTrends([
    { query: 'wool coat', trend: 'rising', growth: 0.4, seasonalMonths: [12] },
  ]);

  const out = applyDemandToUniverse(universe, trends, { month: 12 });

  // Input not mutated
  assert.equal(universe[0].value, 100);
  assert.equal(universe[0].demand, undefined);

  // Matching entry scaled by 2.1, fields added
  assert.ok(Math.abs(out[0].value - 210) < 1e-9);
  assert.equal(out[0].demand, 2.1);
  assert.equal(out[0].trend, 'rising');

  // Non-matching entry unchanged in value, multiplier 1, trend 'unknown'
  assert.equal(out[1].value, 50);
  assert.equal(out[1].demand, 1);
  assert.equal(out[1].trend, 'unknown');
});

test('risingOpportunities returns rising/in-season queries sorted by value desc', () => {
  const universe = [
    { query: 'wool coat', value: 100 },   // rising + in season
    { query: 'sandals', value: 80 },      // in season only (flat trend)
    { query: 'plain tee', value: 200 },   // no trend -> excluded
    { query: 'flip phone', value: 90 },   // declining -> excluded
  ];
  const trends = ingestTrends([
    { query: 'wool coat', trend: 'rising', growth: 0.4, seasonalMonths: [12] },
    { query: 'sandals', trend: 'flat', growth: 0, seasonalMonths: [12] },
    { query: 'flip phone', trend: 'declining', growth: -0.5, seasonalMonths: [] },
  ]);

  const out = risingOpportunities(universe, trends, { month: 12 });

  const queries = out.map((e) => e.query);
  assert.deepEqual(queries, ['wool coat', 'sandals']);

  // wool coat: 100 * 2.1 = 210; sandals: 80 * 1.5 = 120; sorted desc
  assert.ok(Math.abs(out[0].value - 210) < 1e-9);
  assert.ok(Math.abs(out[1].value - 120) < 1e-9);

  // limit caps results
  assert.equal(risingOpportunities(universe, trends, { month: 12, limit: 1 }).length, 1);
});
