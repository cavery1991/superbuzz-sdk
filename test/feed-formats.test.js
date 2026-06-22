import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFeed, createShoppingSystem } from '../src/index.js';

const taxonomy = createShoppingSystem().taxonomy;

test('ingests a Google RSS/XML product feed', () => {
  const xml = `<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>
  <item>
    <g:id>SKU-1</g:id>
    <title>Waterproof Hiking Boots</title>
    <g:description><![CDATA[Rugged leather boots & more]]></g:description>
    <g:price>159.99 USD</g:price>
    <g:availability>in stock</g:availability>
    <g:brand>Timberland</g:brand>
    <g:google_product_category>3237</g:google_product_category>
    <g:color>brown</g:color>
    <g:size>11</g:size>
  </item>
  <item>
    <g:id>SKU-2</g:id>
    <g:title>Blue Sneakers</g:title>
    <g:price>99.99 USD</g:price>
    <g:availability>out of stock</g:availability>
    <g:google_product_category>187</g:google_product_category>
    <g:color>blue</g:color>
  </item>
</channel></rss>`;
  const items = ingestFeed(xml, taxonomy);
  assert.equal(items.length, 2);
  const a = items[0];
  assert.equal(a.product.id, 'SKU-1');
  assert.equal(a.product.title, 'Waterproof Hiking Boots');
  assert.equal(a.product.price, 159.99);
  assert.equal(a.product.inStock, true);
  assert.equal(a.product.categoryId, 3237);
  assert.equal(a.product.attributes.color, 'brown');
  assert.ok(a.raw.description.includes('& more')); // CDATA + entity decoded
  assert.equal(items[1].product.inStock, false);
  assert.equal(items[1].product.title, 'Blue Sneakers'); // g:title fallback
});

test('ingests a CSV feed with quoted fields', () => {
  const csv = [
    'id,title,description,price,availability,brand,google_product_category,color',
    'SKU-9,"Parka, Insulated","Warm, down-filled jacket",249.99 USD,in_stock,NorthPeak,5598,navy',
  ].join('\n');
  const items = ingestFeed(csv, taxonomy);
  assert.equal(items.length, 1);
  assert.equal(items[0].product.title, 'Parka, Insulated'); // comma inside quotes preserved
  assert.equal(items[0].product.price, 249.99);
  assert.equal(items[0].product.categoryId, 5598);
  assert.equal(items[0].product.attributes.color, 'navy');
});

test('still ingests TSV and JSON', () => {
  const tsv = 'id\ttitle\tprice\nSKU-3\tThing\t10.00 USD';
  assert.equal(ingestFeed(tsv, taxonomy)[0].product.id, 'SKU-3');
  const json = JSON.stringify([{ id: 'SKU-4', title: 'JSON Thing', price: '5 USD' }]);
  assert.equal(ingestFeed(json, taxonomy)[0].product.title, 'JSON Thing');
});
