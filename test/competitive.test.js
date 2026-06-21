/**
 * Tests for the competitive intelligence module. Builds a real shopping system,
 * indexes a mix of "own" and "competitor" products, and exercises share of
 * voice, price comparison, and title-gap detection against the live engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShoppingSystem } from '../src/index.js';
import { shareOfVoice, priceComparison, titleGaps } from '../src/competitive/competitive.js';

const APPAREL = 187; // outerwear-ish category for own + competitor products
const FOOTWEAR = 200; // a second category used for price comparison

/** Build a system and index own + competitor products; return handy references. */
function buildSystem() {
  const sys = createShoppingSystem();

  const own = [
    { id: 'own-1', title: 'Insulated Down Parka', price: 220, categoryId: APPAREL, attributes: { color: 'navy' } },
    { id: 'own-2', title: 'Lightweight Rain Jacket', price: 140, categoryId: APPAREL, attributes: { color: 'green' } },
    { id: 'own-3', title: 'Trail Running Shoes', price: 130, categoryId: FOOTWEAR, attributes: { color: 'gray' } },
  ];
  const competitors = [
    { id: 'comp-1', title: 'Waterproof Insulated Winter Parka Coat', price: 150, categoryId: APPAREL, attributes: { color: 'black' } },
    { id: 'comp-2', title: 'Mens Waterproof Hooded Jacket', price: 120, categoryId: APPAREL, attributes: { color: 'blue' } },
    { id: 'comp-3', title: 'Waterproof Insulated Snow Coat', price: 160, categoryId: APPAREL, attributes: { color: 'red' } },
    { id: 'comp-4', title: 'Trail Running Shoes', price: 90, categoryId: FOOTWEAR, attributes: { color: 'white' } },
  ];

  for (const p of [...own, ...competitors]) sys.engine.index(p);

  return { sys, own, competitors };
}

test('shareOfVoice returns overall in [0,1] with per-query entries', () => {
  const { sys, own } = buildSystem();
  const ownIds = new Set(own.map((p) => p.id));
  const queries = ['warm winter coat', 'waterproof jacket', 'trail shoes'];

  const sov = shareOfVoice({ engine: sys.engine, queries, ownIds, k: 3 });

  assert.ok(sov.overall >= 0 && sov.overall <= 1, `overall out of range: ${sov.overall}`);
  assert.equal(sov.perQuery.length, queries.length);
  for (const q of sov.perQuery) {
    assert.equal(q.total, 3);
    assert.ok(q.topIds.length <= 3);
    assert.ok(q.ownInTopK >= 0 && q.ownInTopK <= q.total);
    assert.ok(typeof q.query === 'string');
  }
});

test('priceComparison flags a category where own is pricier', () => {
  const { own, competitors } = buildSystem();
  const cmp = priceComparison({ ownProducts: own, competitorProducts: competitors });

  const apparel = cmp.get(APPAREL);
  assert.ok(apparel, 'expected an entry for the apparel category');
  // own median (220, 140 -> 180) vs competitor median (150,120,160 -> 150): own is pricier.
  assert.equal(apparel.position, 'pricier');
  assert.ok(apparel.delta > 0, `expected positive delta, got ${apparel.delta}`);
  assert.equal(apparel.ownMedian, 180);
  assert.equal(apparel.competitorMedian, 150);

  // Footwear: own 130 vs comp 90 -> also pricier (sanity on a second bucket).
  const footwear = cmp.get(FOOTWEAR);
  assert.equal(footwear.position, 'pricier');
});

test('titleGaps surfaces a competitor token missing from the own title', () => {
  const { own, competitors } = buildSystem();
  const ownProduct = own.find((p) => p.id === 'own-1'); // "Insulated Down Parka"

  const gaps = titleGaps({ ownProduct, competitorProducts: competitors, top: 8 });

  // "waterproof" appears in multiple apparel competitor titles but not in the own title.
  assert.ok(gaps.includes('waterproof'), `expected 'waterproof' in gaps: ${JSON.stringify(gaps)}`);
  // Tokens already in the own title must never be reported as gaps.
  assert.ok(!gaps.includes('parka'), `'parka' is in the own title and should not be a gap: ${JSON.stringify(gaps)}`);
  assert.ok(gaps.length <= 8);
});
