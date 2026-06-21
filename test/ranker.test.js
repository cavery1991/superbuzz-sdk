/**
 * Tests for the learned ranker: sigmoid/predict ranges, ranking order with the
 * default weights, logistic-regression training on synthetic data, and
 * JSON round-tripping.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURE_KEYS,
  DEFAULT_WEIGHTS,
  sigmoid,
  LearnedRanker,
} from '../src/ranking/ranker.js';

test('sigmoid(0) is 0.5 and predict stays in (0,1)', () => {
  assert.equal(sigmoid(0), 0.5);

  const ranker = new LearnedRanker();
  for (const features of [
    {},
    { semantic: 1, category: 1, price: 1, quality: 1, availability: 1, attr: 1 },
    { semantic: 0, category: 0, price: 0, quality: 0, availability: 0, attr: 0 },
  ]) {
    const p = ranker.predict(features);
    assert.ok(p > 0 && p < 1, `predict out of range: ${p}`);
  }
});

test('FEATURE_KEYS and DEFAULT_WEIGHTS line up', () => {
  assert.deepEqual([...FEATURE_KEYS], ['semantic', 'category', 'price', 'quality', 'availability', 'attr']);
  for (const key of FEATURE_KEYS) {
    assert.equal(typeof DEFAULT_WEIGHTS[key], 'number', `missing weight for ${key}`);
  }
  assert.equal(typeof DEFAULT_WEIGHTS.bias, 'number');
});

test('rank() orders a clearly-relevant item above an irrelevant one', () => {
  const ranker = new LearnedRanker();
  const items = [
    { id: 'irrelevant', features: { semantic: 0.05, category: 0, quality: 0.2, availability: 0 } },
    { id: 'relevant', features: { semantic: 0.95, category: 1, quality: 0.9, availability: 1, attr: 1 } },
  ];
  const ranked = ranker.rank(items);
  assert.equal(ranked[0].id, 'relevant');
  assert.equal(ranked[1].id, 'irrelevant');
  assert.ok(ranked[0].score > ranked[1].score);
  // original items are not mutated
  assert.equal(items[0].score, undefined);
});

test('train() lowers loss and learns the semantic signal', () => {
  // ~40 synthetic samples: label correlates strongly with semantic > 0.5,
  // with a touch of deterministic "noise" so it isn't perfectly separable.
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const semantic = i / 39; // 0 .. 1
    let label = semantic > 0.5 ? 1 : 0;
    if (i % 11 === 0) label = 1 - label; // flip a few labels as noise
    samples.push({
      features: {
        semantic,
        category: (i % 3) / 2,
        price: (i % 5) / 4,
        quality: ((i + 1) % 4) / 3,
        availability: i % 2,
        attr: (i % 7) / 6,
      },
      label,
    });
  }

  const ranker = new LearnedRanker();
  const initialLoss = avgLoss(ranker, samples);

  const result = ranker.train(samples, { epochs: 500, lr: 0.5 });

  assert.equal(result.epochs, 500);
  assert.ok(result.finalLoss < initialLoss, `loss did not drop: ${initialLoss} -> ${result.finalLoss}`);

  const positive = ranker.predict({ semantic: 0.9 });
  const negative = ranker.predict({ semantic: 0.1 });
  assert.ok(positive > 0.5, `clear positive predicted ${positive}`);
  assert.ok(negative < 0.5, `clear negative predicted ${negative}`);
});

test('toJSON/fromJSON round-trips and predicts identically', () => {
  const ranker = new LearnedRanker({ semantic: 2.5, category: 0.7, price: -0.3, quality: 0.1, availability: 0.4, attr: 0.2, bias: -1.1 });
  const restored = LearnedRanker.fromJSON(JSON.parse(JSON.stringify(ranker.toJSON())));

  assert.deepEqual(restored.weights, ranker.weights);

  for (const features of [
    { semantic: 0.8, category: 1, price: 0.5, quality: 0.6, availability: 1, attr: 0.3 },
    {},
    { semantic: 0.2, attr: 1 },
  ]) {
    assert.equal(restored.predict(features), ranker.predict(features));
  }
});

/** Average log loss of a ranker over samples (mirrors train's metric). */
function avgLoss(ranker, samples) {
  const eps = 1e-12;
  let total = 0;
  for (const { features, label } of samples) {
    const p = Math.min(Math.max(ranker.predict(features), eps), 1 - eps);
    total += -(label * Math.log(p) + (1 - label) * Math.log(1 - p));
  }
  return total / samples.length;
}
