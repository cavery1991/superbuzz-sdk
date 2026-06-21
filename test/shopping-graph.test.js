import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingGraph } from '../src/graph/shopping-graph.js';

function seed() {
  const g = new ShoppingGraph();
  g.upsertAll([
    { id: '1', title: 'Blue Sneakers', brand: 'Nike', price: 100, categoryId: 187, attributes: { color: 'blue' }, inStock: true, rating: 4.5 },
    { id: '2', title: 'Red Sneakers', brand: 'Nike', price: 80, categoryId: 187, attributes: { color: 'red' }, inStock: false, rating: 4.0 },
    { id: '3', title: 'Parka', brand: 'NorthPeak', price: 250, categoryId: 5598, attributes: { color: 'blue' }, inStock: true, rating: 4.8 },
  ]);
  return g;
}

test('upsert + get + size', () => {
  const g = seed();
  assert.equal(g.size, 3);
  assert.equal(g.get('1').title, 'Blue Sneakers');
  assert.equal(g.get('missing'), null);
});

test('filter by brand and category', () => {
  const g = seed();
  assert.equal(g.filter({ brand: 'Nike' }).length, 2);
  assert.equal(g.filter({ categoryId: 5598 }).length, 1);
});

test('filter by attribute and stock', () => {
  const g = seed();
  const blue = g.filter({ attributes: { color: 'blue' } });
  assert.deepEqual(blue.map((p) => p.id).sort(), ['1', '3']);
  const blueInStock = g.filter({ attributes: { color: 'blue' }, inStock: true });
  assert.deepEqual(blueInStock.map((p) => p.id).sort(), ['1', '3']);
  assert.equal(g.filter({ inStock: true }).length, 2);
});

test('filter by price and rating', () => {
  const g = seed();
  assert.deepEqual(g.filter({ maxPrice: 100 }).map((p) => p.id).sort(), ['1', '2']);
  assert.deepEqual(g.filter({ minRating: 4.6 }).map((p) => p.id), ['3']);
});

test('upsert replaces and keeps indexes consistent', () => {
  const g = seed();
  g.upsert({ id: '1', title: 'Blue Sneakers', brand: 'Adidas', categoryId: 187, attributes: { color: 'green' } });
  assert.equal(g.filter({ brand: 'Nike' }).length, 1);
  assert.equal(g.filter({ brand: 'Adidas' }).length, 1);
  assert.equal(g.filter({ attributes: { color: 'blue' } }).length, 1);
});

test('inStock inferred from inventory', () => {
  const g = new ShoppingGraph();
  g.upsert({ id: 'x', title: 'thing', inventory: 0 });
  g.upsert({ id: 'y', title: 'thing2', inventory: 5 });
  assert.equal(g.get('x').inStock, false);
  assert.equal(g.get('y').inStock, true);
});

test('stats aggregates the catalog', () => {
  const s = seed().stats();
  assert.equal(s.products, 3);
  assert.equal(s.brands, 2);
  assert.equal(s.inStock, 2);
});
