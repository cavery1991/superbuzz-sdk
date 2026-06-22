import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShoppingSystem, predictAppearance, predictForProduct } from '../src/index.js';

function system() {
  const sys = createShoppingSystem();
  sys.engine.indexAll([
    { id: 'boot', title: 'Waterproof Hiking Boots', categoryId: 3237, attributes: { color: 'brown', material: 'leather' }, inStock: true },
    { id: 'boot-oos', title: 'Trail Waterproof Hiking Boots', categoryId: 3237, attributes: { color: 'black' }, inStock: false },
    { id: 'pan', title: 'Nonstick Frying Pan', categoryId: 668, attributes: {}, inStock: true },
  ]);
  return sys;
}

test('relevant + eligible product is predicted to appear', () => {
  const sys = system();
  const r = predictForProduct({ engine: sys.engine, query: 'waterproof hiking boots' }, 'boot');
  assert.equal(r.verdict, 'appears');
  assert.ok(r.relevance >= 0.45);
  assert.ok(r.probability > 0.5);
  assert.equal(r.rank, 1);
});

test('relevant but out-of-stock product is ineligible (gated, not appearing)', () => {
  const sys = system();
  const r = predictForProduct({ engine: sys.engine, query: 'waterproof hiking boots' }, 'boot-oos');
  assert.equal(r.verdict, 'ineligible');
  assert.equal(r.probability, 0);
  assert.ok(r.eligibilityIssues.includes('out of stock'));
});

test('irrelevant product will not appear', () => {
  const sys = system();
  const r = predictForProduct({ engine: sys.engine, query: 'waterproof hiking boots' }, 'pan');
  assert.equal(r.verdict, 'absent');
  assert.ok(r.relevance < 0.45);
});

test('predictAppearance summarizes counts and ranks appearers by relevance', () => {
  const sys = system();
  const out = predictAppearance({ engine: sys.engine, query: 'waterproof hiking boots' });
  assert.equal(out.counts.appears, 1);
  assert.equal(out.counts.ineligible, 1);
  assert.ok(out.rows.every((r) => r.verdict !== 'appears' || r.rank >= 1));
  assert.equal(out.intentCategoryId, 3237);
});

test('fix path: optimized embedding can flip a borderline product to appearing', () => {
  const sys = system();
  // A sparse listing that under-represents the query; supply a richer optimized vector.
  sys.engine.index({ id: 'sparse', title: 'Boots', categoryId: 3237, attributes: {}, inStock: true });
  const optimized = new Map([
    ['sparse', sys.embedder.embed('Waterproof Hiking Boots brown leather durable Apparel Accessories Shoes Boots')],
  ]);
  const r = predictForProduct(
    { engine: sys.engine, query: 'waterproof hiking boots', optimizedById: optimized },
    'sparse',
  );
  assert.ok(r.afterFix);
  assert.ok(r.afterFix.relevance >= r.relevance);
});
