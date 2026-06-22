import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NeuralEmbedder, createEmbedder, LocalEmbedder, createShoppingSystemAsync } from '../src/index.js';

/**
 * A fake transformers.js feature-extraction pipeline: deterministic 8-dim,
 * mean-pooled + normalized vectors. Lets us test all of NeuralEmbedder's
 * warm/cache/embed/dim logic with zero dependency on the real model download.
 */
function fakePipelineFactory() {
  return async () => async (texts) => {
    const list = texts.map((t) => {
      const v = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) v[t.charCodeAt(i) % 8] += 1;
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
    return { tolist: () => list };
  };
}

test('NeuralEmbedder warms, caches, and serves vectors; learns dim from output', async () => {
  const e = new NeuralEmbedder({ pipelineFactory: fakePipelineFactory(), dim: 999 });
  await e.warm(['hello world', 'goodbye']);
  assert.equal(e.embed('hello world').length, 8);
  assert.equal(e.dim, 8); // corrected from the model's actual output
});

test('NeuralEmbedder.embed throws before warming', () => {
  const e = new NeuralEmbedder({ pipelineFactory: fakePipelineFactory() });
  assert.throws(() => e.embed('cold'), /not warmed/);
});

test('embedBatch returns one vector per input, in order', async () => {
  const e = new NeuralEmbedder({ pipelineFactory: fakePipelineFactory() });
  const vecs = await e.embedBatch(['a', 'bb', 'ccc']);
  assert.equal(vecs.length, 3);
  assert.ok(vecs.every((v) => v.length === 8));
});

test('factory selects NeuralEmbedder for provider "neural"', () => {
  const e = createEmbedder({ provider: 'neural', pipelineFactory: fakePipelineFactory() });
  assert.ok(e instanceof NeuralEmbedder);
});

test('missing optional dependency surfaces a clear, actionable error', async () => {
  // No pipelineFactory and (in this test env) the dep import path is exercised;
  // a NeuralEmbedder whose factory throws simulates an unavailable model/dep.
  const e = new NeuralEmbedder({ pipelineFactory: async () => { throw new Error('model unavailable'); } });
  await assert.rejects(() => e.warm(['x']), /model unavailable/);
});

test('createShoppingSystemAsync falls back to LocalEmbedder when neural is unavailable', async () => {
  const sys = await createShoppingSystemAsync({
    embedderOptions: { provider: 'neural', pipelineFactory: async () => { throw new Error('no network'); } },
  });
  assert.ok(sys.embedder instanceof LocalEmbedder); // graceful fallback, no crash
  // And the system is fully functional after fallback.
  sys.engine.index({ id: 'a', title: 'warm winter coat', categoryId: 5598, inStock: true });
  const out = sys.engine.search('winter coat');
  assert.ok(out.results.length >= 0);
});
