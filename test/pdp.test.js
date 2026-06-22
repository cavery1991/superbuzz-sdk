import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractProductFromHtml, inferSearchQueries, scanProduct, createShoppingSystem } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(__dirname, '../data/sample-pdp.html'), 'utf8');

test('extractProductFromHtml pulls the product from JSON-LD', () => {
  const p = extractProductFromHtml(HTML, { url: 'https://store.example/p/parka' });
  assert.equal(p.title, 'Summit Insulated Down Parka');
  assert.equal(p.brand, 'NorthPeak');
  assert.equal(p.price, 249.99);
  assert.equal(p.inStock, true);
  assert.equal(p.attributes.color, 'navy');
  assert.equal(p.id, 'NP-PARKA-700');
  assert.equal(p.link, 'https://store.example/p/parka');
});

test('extractProductFromHtml falls back to OpenGraph/title when no JSON-LD', () => {
  const html = `<html><head><title>Red Running Shoes | Acme</title>
    <meta property="og:title" content="Red Running Shoes">
    <meta property="product:price:amount" content="79.99"></head><body></body></html>`;
  const p = extractProductFromHtml(html);
  assert.equal(p.title, 'Red Running Shoes');
  assert.equal(p.price, 79.99);
  assert.equal(p.inStock, true); // default when unknown
});

test('inferSearchQueries proposes attribute/brand/concept variants', () => {
  const sys = createShoppingSystem();
  const p = sys.engine.index({ ...extractProductFromHtml(HTML) });
  const qs = inferSearchQueries(p, sys.taxonomy);
  assert.ok(qs.length > 3);
  // includes the head noun and an attribute variant
  assert.ok(qs.some((q) => /coat|jacket|parka/.test(q)));
  assert.ok(qs.some((q) => q.includes('navy')));
  // evidenced concepts (warm/waterproof) become target modifiers
  assert.ok(qs.some((q) => /warm|insulated|waterproof|winter|cold/.test(q)));
});

test('scanProduct scores likelihood per query and gates on eligibility', () => {
  const sys = createShoppingSystem();
  const product = sys.engine.index({ ...extractProductFromHtml(HTML) });
  const out = scanProduct({ engine: sys.engine, product, taxonomy: sys.taxonomy });
  assert.ok(out.eligible);
  assert.ok(out.queries.length > 0);
  assert.ok(out.queries.every((q) => q.likelihood >= 0 && q.likelihood <= 1));
  // sorted by relevance descending
  for (let i = 1; i < out.queries.length; i++) {
    assert.ok(out.queries[i - 1].relevance >= out.queries[i].relevance);
  }
  // an out-of-stock product is ineligible across the board
  const oos = sys.engine.index({ ...extractProductFromHtml(HTML), id: 'oos', inStock: false });
  const out2 = scanProduct({ engine: sys.engine, product: oos, taxonomy: sys.taxonomy });
  assert.equal(out2.eligible, false);
  assert.ok(out2.queries.every((q) => q.verdict === 'ineligible'));
});
