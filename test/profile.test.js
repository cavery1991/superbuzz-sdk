import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProductProfile } from '../src/product/profile.js';
import { createShoppingSystem } from '../src/index.js';

test('fuses feed + schema JSON-LD', () => {
  const { product } = buildProductProfile({
    feed: { id: 'a', title: 'Rain Jacket' },
    schema: {
      '@type': 'Product',
      name: 'Rain Jacket',
      brand: { name: 'Acme' },
      color: 'Yellow',
      offers: { price: '79.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      aggregateRating: { ratingValue: 4.6, reviewCount: 210 },
    },
  });
  assert.equal(product.brand, 'Acme');
  assert.equal(product.attributes.color, 'yellow');
  assert.equal(product.price, 79.99);
  assert.equal(product.inStock, true);
  assert.equal(product.rating, 4.6);
});

test('computer-vision tags enrich the text profile', () => {
  const { enrichedText, derivedTags } = buildProductProfile({
    feed: { id: 'b', title: 'Cotton Shirt', description: 'a comfy shirt' },
    visionTags: ['striped', 'blue'],
  });
  assert.ok(/striped/.test(enrichedText));
  assert.ok(derivedTags.includes('striped'));
});

test('review mining derives semantic tags + concepts', () => {
  const { derivedTags, derivedConcepts } = buildProductProfile({
    feed: { id: 'c', title: 'Light Jacket', description: 'water-resistant shell' },
    reviews: [
      'This jacket kept me totally dry in a downpour!',
      { text: 'Super warm and cozy', rating: 5 },
    ],
  });
  assert.ok(derivedTags.includes('rain protection'));
  assert.ok(derivedConcepts.includes('waterproof'));
  assert.ok(derivedTags.includes('warmth'));
});

test('reviews roll up into rating when none supplied', () => {
  const { product } = buildProductProfile({
    feed: { id: 'd', title: 'Pan' },
    reviews: [{ text: 'great', rating: 4 }, { text: 'good', rating: 5 }],
  });
  assert.equal(product.rating, 4.5);
  assert.equal(product.reviewCount, 2);
});

test('review-derived semantics affect search ranking', () => {
  const sys = createShoppingSystem();
  sys.engine.index({ id: 'plain', title: 'Trail Jacket', description: 'a shell jacket', inStock: true });
  sys.engine.index({
    id: 'reviewed',
    title: 'Storm Jacket',
    description: 'a shell jacket',
    inStock: true,
    reviews: ['kept me totally dry in a downpour', 'no leaks at all'],
  });
  const { results } = sys.engine.search('waterproof rain jacket', { limit: 2 });
  // The reviewed product gains "rain protection"/waterproof semantics.
  assert.equal(results[0].product.id, 'reviewed');
});
