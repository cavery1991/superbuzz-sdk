import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyContext, CoPurchaseModel } from '../src/ranking/context.js';
import { createShoppingSystem } from '../src/index.js';

function results() {
  // Two near-tied results; context should break the tie.
  return [
    { product: { id: 'far', localInventory: {}, pickupToday: false }, score: 0.80 },
    { product: { id: 'near', localInventory: { 'US-CA': 5 }, pickupToday: true }, score: 0.78 },
  ];
}

test('geo: local inventory boosts nearby products', () => {
  const out = applyContext(results(), { region: 'US-CA' });
  assert.equal(out[0].product.id, 'near');
  assert.ok(out[0].contextBreakdown.geo === 1);
});

test('device: mobile boosts in-store pickup today', () => {
  const out = applyContext(results(), { device: 'mobile' });
  assert.equal(out[0].product.id, 'near');
  assert.ok(out[0].contextBreakdown.pickup === 1);
});

test('co-purchase model: learns and shifts ranking', () => {
  const cp = new CoPurchaseModel();
  cp.observe('dorm room lighting', 'led-strip', 50);
  cp.observe('dorm room lighting', 'desk-lamp', 5);
  assert.equal(cp.affinity('dorm room lighting', 'led-strip'), 1);
  assert.ok(cp.affinity('dorm room lighting', 'desk-lamp') < 1);

  const out = applyContext(
    [
      { product: { id: 'desk-lamp' }, score: 0.6 },
      { product: { id: 'led-strip' }, score: 0.55 },
    ],
    { query: 'dorm room lighting', coPurchase: cp },
  );
  assert.equal(out[0].product.id, 'led-strip');
});

test('engine.search applies context end-to-end', () => {
  const sys = createShoppingSystem();
  sys.engine.index({ id: 'remote', title: 'Generic Sneakers', categoryId: 187, inStock: true, localInventory: {} });
  sys.engine.index({ id: 'local', title: 'Generic Sneakers', categoryId: 187, inStock: true, localInventory: { 'US-CA': 3 } });
  const { results: r } = sys.engine.search('sneakers', {
    context: { region: 'US-CA' },
    limit: 2,
  });
  assert.equal(r[0].product.id, 'local');
  assert.ok(r[0].contextScore > 0);
});
