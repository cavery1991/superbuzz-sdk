import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Taxonomy } from '../src/taxonomy/taxonomy.js';

test('parses official "<id> - <path>" format', () => {
  const tax = Taxonomy.fromText(`# header
166 - Apparel & Accessories
1581 - Apparel & Accessories > Shoes
187 - Apparel & Accessories > Shoes > Athletic Shoes`);
  assert.equal(tax.size, 3);
  assert.equal(tax.get(187).name, 'Athletic Shoes');
  assert.equal(tax.get(187).path, 'Apparel & Accessories > Shoes > Athletic Shoes');
});

test('links parents and children from paths', () => {
  const tax = Taxonomy.sample();
  const athletic = tax.get(187);
  assert.equal(tax.get(athletic.parentId).name, 'Shoes');
  const ancestors = tax.ancestors(187).map((n) => n.name);
  assert.deepEqual(ancestors, ['Apparel & Accessories', 'Shoes', 'Athletic Shoes']);
});

test('lookup by path is case-insensitive', () => {
  const tax = Taxonomy.sample();
  const node = tax.getByPath('apparel & accessories > shoes');
  assert.equal(node.id, 1581);
});

test('children and leaves', () => {
  const tax = Taxonomy.sample();
  const shoes = tax.getByPath('Apparel & Accessories > Shoes');
  const childNames = tax.children(shoes.id).map((n) => n.name).sort();
  assert.deepEqual(childNames, ['Athletic Shoes', 'Boots', 'Sandals']);
  assert.ok(tax.leaves().length > 0);
});
