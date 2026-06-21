import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryParser } from '../src/query/query-parser.js';
import { createShoppingSystem } from '../src/index.js';

test('deconstructs "waterproof black running shoes size 10"', () => {
  const p = new QueryParser().parse('waterproof black running shoes size 10');
  assert.equal(p.coreEntity, 'shoe'); // head noun
  assert.equal(p.modifiers.visual[0], 'black');
  assert.ok(p.modifiers.functional.includes('waterproof'));
  assert.ok(p.modifiers.usage.includes('running'));
  assert.equal(p.specs.size, '10');
  assert.equal(p.attributes.color, 'black');
  assert.equal(p.attributes.size, '10');
});

test('extracts technical specs: 4k and version', () => {
  const a = new QueryParser().parse('65 inch 4k tv');
  assert.equal(a.specs.resolution, '4k');
  const b = new QueryParser().parse('shoe v2 model');
  assert.equal(b.specs.version, 'v2');
});

test('implied intent: "hiking boots that won\'t slip on ice"', () => {
  const p = new QueryParser().parse("hiking boots that won't slip on ice");
  assert.ok(p.impliedConcepts.includes('waterproof'));
  assert.ok(p.impliedConcepts.includes('cold_weather'));
  assert.ok(p.impliedTags.includes('traction'));
  // implied concepts are folded into the semantic text
  assert.notEqual(p.semanticText, p.raw);
});

test('implied intent: "headphones to block out noise on a plane"', () => {
  const p = new QueryParser().parse('headphones to block out noise on a plane');
  assert.ok(p.impliedConcepts.includes('noise_cancelling'));
});

test('core entity maps to a GPC category when a classifier is supplied', () => {
  const sys = createShoppingSystem();
  const parsed = sys.engine.parser.parse('warm winter coat');
  assert.equal(parsed.categoryId, 5598); // Coats & Jackets
});
