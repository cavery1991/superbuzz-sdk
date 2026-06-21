import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createShoppingSystem, ingestSearchTerms,
  evaluate, calibrateThresholds, validateAgainstPerformance,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTS = JSON.parse(readFileSync(resolve(__dirname, '../data/products.enriched.json'), 'utf8'));
const JUDGMENTS = JSON.parse(readFileSync(resolve(__dirname, '../data/relevance.sample.json'), 'utf8'));
const TERMS = ingestSearchTerms(readFileSync(resolve(__dirname, '../data/search-terms.sample.csv'), 'utf8'));

function system() {
  const sys = createShoppingSystem();
  sys.engine.indexAll(PRODUCTS);
  return sys;
}

test('evaluate returns retrieval metrics in range', () => {
  const m = evaluate(system().engine, JUDGMENTS, { k: 5 });
  assert.equal(m.queries, JUDGMENTS.length);
  for (const v of [m.precisionAtK, m.recallAtK, m.mrr, m.ndcgAtK]) {
    assert.ok(v >= 0 && v <= 1, `metric out of range: ${v}`);
  }
  // The engine should retrieve relevant products well on this labeled set.
  assert.ok(m.recallAtK >= 0.8);
  assert.ok(m.mrr >= 0.7);
});

test('calibrateThresholds returns ordered, in-range thresholds + a PR curve', () => {
  const cal = calibrateThresholds(system().engine, JUDGMENTS);
  assert.ok(cal.recommended.well >= cal.recommended.weak);
  assert.ok(cal.recommended.well >= 0 && cal.recommended.well <= 1);
  assert.ok(cal.curve.length > 1);
  assert.ok(cal.best.f1 >= 0 && cal.best.f1 <= 1);
});

test('validateAgainstPerformance buckets real queries and tests the hypothesis', () => {
  const v = validateAgainstPerformance(system().engine, TERMS, { metric: 'conversions' });
  assert.equal(v.rows.length, TERMS.length);
  assert.ok(['well', 'weak', 'gap'].every((b) => b in v.summary));
  // Well-covered queries should not earn less, on average, than gap queries.
  assert.equal(typeof v.holds, 'boolean');
  assert.ok(v.summary.well.avgPerf >= v.summary.gap.avgPerf);
});
