/**
 * Tests for the Merchant Center compliance / disapproval-risk simulator.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkCompliance } from '../src/feed/compliance.js';
import { Taxonomy } from '../src/taxonomy/taxonomy.js';

/** A fully compliant raw feed item + normalized product. */
function cleanFixture() {
  const raw = {
    id: 'SKU1',
    title: 'Acme Trail Running Shoe',
    description: 'Lightweight trail runner.',
    link: 'https://shop.example.com/p/sku1',
    image_link: 'https://shop.example.com/img/sku1.jpg',
    price: '79.99 USD',
    availability: 'in stock',
    brand: 'Acme',
    gtin: '0123456789012',
    mpn: 'ACME-TR-1',
    condition: 'new',
  };
  const product = { id: 'SKU1', price: 79.99, categoryId: null, attributes: {} };
  return { raw, product };
}

test('missing image_link flags disapproval', () => {
  const { raw, product } = cleanFixture();
  delete raw.image_link;
  const result = checkCompliance({ raw, product });
  assert.equal(result.willLikelyDisapprove, true);
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes('missing_image_link'));
  const img = result.issues.find((i) => i.code === 'missing_image_link');
  assert.equal(img.severity, 'disapproval');
});

test('all-caps title is a warning, not a disapproval', () => {
  const { raw, product } = cleanFixture();
  raw.title = 'ACME TRAIL RUNNING SHOE FOR MEN';
  const result = checkCompliance({ raw, product });
  const allCaps = result.issues.find((i) => i.code === 'title_all_caps');
  assert.ok(allCaps, 'expected title_all_caps issue');
  assert.equal(allCaps.severity, 'warning');
  assert.equal(result.willLikelyDisapprove, false);
});

test('promotional text in title is flagged', () => {
  const { raw, product } = cleanFixture();
  raw.title = 'FREE SHIPPING buy now!!!';
  const result = checkCompliance({ raw, product });
  const promo = result.issues.find((i) => i.code === 'title_promotional');
  assert.ok(promo, 'expected title_promotional issue');
  assert.equal(promo.severity, 'warning');
});

test('apparel item missing gender/age_group disapproves', () => {
  const taxonomy = Taxonomy.sample();
  const { raw, product } = cleanFixture();
  // 187 = Apparel & Accessories > Shoes > Athletic Shoes
  product.categoryId = 187;
  // supply color + size but omit gender + age_group
  raw.color = 'black';
  raw.size = '10';
  const result = checkCompliance({ raw, product, taxonomy });
  assert.equal(result.willLikelyDisapprove, true);
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes('apparel_missing_gender'));
  assert.ok(codes.includes('apparel_missing_age_group'));
  assert.ok(!codes.includes('apparel_missing_color'));
  assert.ok(!codes.includes('apparel_missing_size'));
  for (const c of ['apparel_missing_gender', 'apparel_missing_age_group']) {
    assert.equal(result.issues.find((i) => i.code === c).severity, 'disapproval');
  }
});

test('clean complete product has low risk and will not disapprove', () => {
  const taxonomy = Taxonomy.sample();
  const { raw, product } = cleanFixture();
  const result = checkCompliance({ raw, product, taxonomy });
  assert.equal(result.willLikelyDisapprove, false);
  assert.equal(result.issues.length, 0);
  assert.ok(result.riskScore < 10, `expected low riskScore, got ${result.riskScore}`);
});
