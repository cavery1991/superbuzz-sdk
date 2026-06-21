import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, exportForChannel, missingRequiredFields, toTSV,
} from '../src/channels/channels.js';

/** A fully-populated normalized product. */
function sampleProduct(overrides = {}) {
  return {
    id: 'SKU-1002',
    title: 'Trail Runner Sneakers',
    description: 'Lightweight trail running shoes.',
    brand: 'Acme',
    price: 249.99,
    currency: 'USD',
    categoryId: 187,
    attributes: { color: 'blue', size: '10', material: 'mesh' },
    inStock: true,
    link: 'https://example.com/p/1002',
    image_link: 'https://example.com/img/1002.jpg',
    gtin: '0123456789012',
    mpn: 'TR-1002',
    condition: 'new',
    ...overrides,
  };
}

test('exportForChannel: google formatting and category mapping', () => {
  const [rec] = exportForChannel([sampleProduct()], 'google');
  assert.equal(rec.availability, 'in stock');
  assert.equal(rec.price, '249.99 USD');
  assert.equal(rec.google_product_category, 187); // maps from categoryId
  assert.equal(rec.id, 'SKU-1002');
  assert.equal(rec.color, 'blue');
});

test('exportForChannel: meta formatting and category mapping', () => {
  const [rec] = exportForChannel([sampleProduct()], 'meta');
  assert.equal(rec.availability, 'in stock');
  assert.equal(rec.price, '249.99 USD');
  assert.equal(rec.google_product_category, 187); // maps from categoryId
  assert.equal(rec.condition, 'new');
});

test('meta: condition defaults to "new" when absent', () => {
  const [rec] = exportForChannel([sampleProduct({ condition: undefined })], 'meta');
  assert.equal(rec.condition, 'new');
});

test('out of stock maps to "out of stock"', () => {
  const [rec] = exportForChannel([sampleProduct({ inStock: false })], 'google');
  assert.equal(rec.availability, 'out of stock');
});

test('exportForChannel: throws on unknown channel', () => {
  assert.throws(() => exportForChannel([sampleProduct()], 'tiktok'), /Unknown channel/);
});

test('missingRequiredFields: catches a missing image_link for google', () => {
  const [rec] = exportForChannel([sampleProduct({ image_link: undefined })], 'google');
  const missing = missingRequiredFields(rec, 'google');
  assert.ok(missing.includes('image_link'));
});

test('missingRequiredFields: empty for a complete google record', () => {
  const [rec] = exportForChannel([sampleProduct()], 'google');
  assert.deepEqual(missingRequiredFields(rec, 'google'), []);
});

test('toTSV: header row plus N data rows', () => {
  const records = exportForChannel([sampleProduct(), sampleProduct({ id: 'SKU-1003' })], 'google');
  const tsv = toTSV(records);
  const lines = tsv.split('\n');
  assert.equal(lines.length, records.length + 1); // header + N rows
  assert.ok(lines[0].includes('id'));
  assert.ok(lines[0].includes('\t'));
  assert.equal(lines[1].split('\t').length, lines[0].split('\t').length);
});

test('CHANNELS exposes google, meta, amazon specs', () => {
  assert.deepEqual(Object.keys(CHANNELS).sort(), ['amazon', 'google', 'meta']);
  assert.equal(CHANNELS.amazon.map(sampleProduct()).sku, 'SKU-1002');
});
