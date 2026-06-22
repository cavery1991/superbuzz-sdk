import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ingestFeed, ingestSearchTerms, buildQueryUniverse,
  auditProduct, optimizeProduct, analyzeFeed, createShoppingSystem,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(resolve(__dirname, '../data/feed.sample.json'), 'utf8');
const TERMS = readFileSync(resolve(__dirname, '../data/search-terms.sample.csv'), 'utf8');

test('ingestFeed: normalizes Google feed spec fields', () => {
  const sys = createShoppingSystem();
  const items = ingestFeed(FEED, sys.taxonomy);
  const boots = items.find((i) => i.product.id === 'SKU-1004');
  assert.equal(boots.product.price, 159.99);
  assert.equal(boots.product.currency, 'USD');
  assert.equal(boots.product.inStock, true);
  assert.equal(boots.product.attributes.color, 'brown');

  // The daypack feed omits google_product_category → categoryId stays null.
  const daypack = items.find((i) => i.product.id === 'SKU-1006');
  assert.equal(daypack.product.categoryId, null);
  assert.ok(!daypack.provided.has('google_product_category'));

  const sneakers = items.find((i) => i.product.id === 'SKU-1002');
  assert.equal(sneakers.product.categoryId, 187); // numeric gpc resolved
});

test('ingestFeed: resolves a GPC path string to an id', () => {
  const sys = createShoppingSystem();
  const [item] = ingestFeed(
    [{ id: 'x', title: 'Boot', google_product_category: 'Apparel & Accessories > Shoes > Boots' }],
    sys.taxonomy,
  );
  assert.equal(item.product.categoryId, 3237);
});

test('ingestSearchTerms: parses CSV and weights by conversions', () => {
  const rows = ingestSearchTerms(TERMS);
  assert.ok(rows.length >= 10);
  const head = rows.find((r) => r.query === 'noise cancelling headphones');
  assert.equal(head.conversions, 31);
  assert.ok(head.value > 0);
});

test('buildQueryUniverse: merges real terms with generated ones', () => {
  const sys = createShoppingSystem();
  const items = ingestFeed(FEED, sys.taxonomy);
  const products = items.map((i) => sys.engine.index(i.product));
  const universe = buildQueryUniverse({
    products,
    taxonomy: sys.taxonomy,
    searchTerms: ingestSearchTerms(TERMS),
  });
  assert.ok(universe.some((q) => q.source === 'real'));
  assert.ok(universe.some((q) => q.source === 'generated'));
});

test('auditProduct: flags missing GPC, short title, missing attributes', () => {
  const sys = createShoppingSystem();
  const [item] = ingestFeed([{ id: 'a', title: 'Parka', description: 'warm', price: '100 USD', availability: 'in_stock' }], sys.taxonomy);
  const product = sys.engine.index(item.product);
  const audit = auditProduct({
    raw: item.raw, provided: item.provided, product,
    classifier: sys.classifier, taxonomy: sys.taxonomy,
  });
  assert.ok(audit.score < 100);
  const types = audit.issues.map((i) => i.type);
  assert.ok(types.includes('missing_required') || types.includes('missing_recommended'));
  assert.ok(types.includes('title_short'));
});

test('optimizeProduct: enriches title additively and never drops content', () => {
  const sys = createShoppingSystem();
  const raw = { id: 'b', title: 'Cloudrunner Running Sneakers', brand: 'Nike', color: 'blue', size: '10' };
  const [item] = ingestFeed([raw], sys.taxonomy);
  const product = sys.engine.index(item.product);
  const audit = auditProduct({ raw: item.raw, provided: item.provided, product, classifier: sys.classifier, taxonomy: sys.taxonomy });
  const opt = optimizeProduct({ raw: item.raw, product, audit, taxonomy: sys.taxonomy });
  // Original significant words are preserved.
  assert.ok(/cloudrunner/i.test(opt.suggestedTitle));
  assert.ok(/running sneakers/i.test(opt.suggestedTitle));
  // Missing brand is added.
  assert.ok(/nike/i.test(opt.suggestedTitle));
  // optimizedText is a superset (contains the original title).
  assert.ok(opt.optimizedText.toLowerCase().includes('cloudrunner running sneakers'));
});

test('optimizeProduct: recommends fixing a missing/incorrect GPC', () => {
  const sys = createShoppingSystem();
  const [item] = ingestFeed([{ id: 'c', title: 'Insulated Down Parka', description: 'warm winter coat for snow' }], sys.taxonomy);
  const product = sys.engine.index(item.product);
  const audit = auditProduct({ raw: item.raw, provided: item.provided, product, classifier: sys.classifier, taxonomy: sys.taxonomy });
  const opt = optimizeProduct({ raw: item.raw, product, audit, taxonomy: sys.taxonomy, derivedConcepts: [] });
  assert.ok(opt.recommendations.some((r) => r.type === 'set_gpc'));
});

test('analyzeFeed: produces a combined report with before/after coverage lift', () => {
  const report = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS });
  assert.equal(report.summary.products, 6);
  assert.ok(report.summary.queryUniverse.real >= 10);
  // Optimizing the feed should never reduce well-coverage, and here it increases.
  assert.ok(report.summary.estimatedLift.wellAfter >= report.summary.estimatedLift.wellBefore);
  assert.ok(report.summary.estimatedLift.queriesFixed > 0);
  // Worst feed score is listed first.
  for (let i = 1; i < report.products.length; i++) {
    assert.ok(report.products[i - 1].feedScore <= report.products[i].feedScore);
  }
});

test('analyzeFeed: a poorly-built product gains coverage from its fixes', () => {
  const report = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS });
  const boots = report.products.find((p) => p.id === 'SKU-1004'); // missing GPC + review signals
  assert.ok(boots.simulation.newlyCovered > 0);
  assert.ok(boots.recommendations.length > 0);
});

test('analyzeFeed: works with no search terms (generated universe only)', () => {
  const report = analyzeFeed({ feed: FEED });
  assert.equal(report.summary.queryUniverse.real, 0);
  assert.ok(report.summary.queryUniverse.generated > 0);
});
