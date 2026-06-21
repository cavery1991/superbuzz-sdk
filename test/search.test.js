import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createShoppingSystem } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTS = JSON.parse(
  readFileSync(resolve(__dirname, '../data/products.sample.json'), 'utf8'),
);

function system() {
  const sys = createShoppingSystem();
  sys.engine.indexAll(PRODUCTS);
  return sys;
}

test('classifier maps text to the right GPC aisle', () => {
  const sys = createShoppingSystem();
  assert.equal(sys.classifier.bestCategoryId('athletic running sneakers'), 187);
  const coat = sys.classifier.classify('warm insulated winter coat', 1)[0];
  assert.equal(coat.id, 5598); // Coats & Jackets
});

test('indexing auto-classifies products into the taxonomy', () => {
  const sys = system();
  const parka = sys.graph.get('p1');
  assert.equal(parka.categoryId, 5598);
  assert.ok(parka.embedding, 'product should be embedded');
});

test('semantic search: "warm winter coat" finds the parka without the word "coat"', () => {
  const sys = system();
  const { results } = sys.engine.search('warm winter coat', { limit: 3 });
  assert.equal(results[0].product.id, 'p1');
  // The parka title/description never contains the word "coat".
  assert.ok(!/coat/i.test(results[0].product.title + results[0].product.description));
});

test('"blue nike sneakers" ranks the in-stock blue Nike sneaker first', () => {
  const sys = system();
  const { results, intent } = sys.engine.search('blue nike sneakers');
  assert.equal(intent.detectedAttributes.color, 'blue');
  assert.equal(results[0].product.id, 'p2');
});

test('inStockOnly filters out-of-stock products', () => {
  const sys = system();
  const { results } = sys.engine.search('blue nike sneakers', { inStockOnly: true });
  assert.ok(results.every((r) => r.product.inStock));
  assert.ok(!results.some((r) => r.product.id === 'p3')); // p3 is out of stock
});

test('semantic match across vocabulary: "earbuds" -> noise cancelling headphones', () => {
  const sys = system();
  const { results } = sys.engine.search('wireless noise cancelling earbuds', { limit: 1 });
  assert.equal(results[0].product.id, 'p5');
});

test('brand filter restricts results', () => {
  const sys = system();
  const { results } = sys.engine.search('shoes', { brand: 'Nike' });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.product.brand === 'Nike'));
});

test('search result carries a score breakdown', () => {
  const sys = system();
  const { results } = sys.engine.search('warm winter coat', { limit: 1 });
  const b = results[0].breakdown;
  assert.ok('semantic' in b && 'categoryBonus' in b && 'attrBonus' in b);
});
