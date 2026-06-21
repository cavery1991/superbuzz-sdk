import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { analyzeFeed } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(resolve(__dirname, '../data/feed.sample.json'), 'utf8');
const TERMS = readFileSync(resolve(__dirname, '../data/search-terms.sample.csv'), 'utf8');

test('analyzeFeed report carries price, compliance, and revenue signals', () => {
  const report = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS });

  // Summary aggregates the new dimensions.
  assert.ok(report.summary.revenue);
  assert.equal(typeof report.summary.revenue.totalMonthly, 'number');
  assert.equal(report.summary.revenue.totalAnnual, report.summary.revenue.totalMonthly * 12);
  assert.ok('atRisk' in report.summary.compliance);
  assert.ok('aboveMarket' in report.summary.pricing);

  // Each product carries price competitiveness and compliance.
  for (const p of report.products) {
    assert.ok(p.price && 'position' in p.price);
    assert.ok(p.compliance && 'willLikelyDisapprove' in p.compliance);
  }
});

test('a feed item missing required apparel fields is flagged at disapproval risk', () => {
  // SKU-1004 (boots) and SKU-1001 (parka) omit gender/age_group → apparel disapproval.
  const report = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS });
  const flagged = report.products.filter((p) => p.compliance.willLikelyDisapprove);
  assert.ok(flagged.length > 0);
});

test('revenue is attributed only to fixable, real-traffic opportunities', () => {
  const withTerms = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS }).summary.revenue.totalMonthly;
  const without = analyzeFeed({ feed: FEED }).summary.revenue.totalMonthly;
  // Generated-only queries have no impressions/clicks, so no real revenue is projected.
  assert.equal(without, 0);
  assert.ok(withTerms >= 0);
});
