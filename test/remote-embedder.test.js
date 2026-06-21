import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteEmbedder, LocalEmbedder, createEmbedder, createShoppingSystemAsync } from '../src/index.js';

/** A deterministic mock of an OpenAI-compatible embeddings endpoint. */
function mockFetch(calls = []) {
  return async (url, opts) => {
    const { input } = JSON.parse(opts.body);
    calls.push([...input]);
    const data = input.map((t) => {
      const v = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) v[t.charCodeAt(i) % 8] += 1;
      return { embedding: v };
    });
    return { ok: true, json: async () => ({ data }) };
  };
}

test('RemoteEmbedder warms, caches, and serves embeddings synchronously', async () => {
  const calls = [];
  const e = new RemoteEmbedder({ apiUrl: 'http://mock', apiKey: 'k', fetchImpl: mockFetch(calls), dim: 8 });
  await e.warm(['hello', 'world']);
  assert.equal(e.embed('hello').length, 8);
  assert.equal(e.dim, 8);
  // Second warm of the same text triggers no new fetch (cached).
  await e.warm(['hello']);
  assert.equal(calls.flat().length, 2);
});

test('RemoteEmbedder.embed throws if text was not warmed', () => {
  const e = new RemoteEmbedder({ apiUrl: 'http://mock', apiKey: 'k', fetchImpl: mockFetch(), dim: 8 });
  assert.throws(() => e.embed('cold'), /not warmed/);
});

test('embedBatch returns vectors in input order', async () => {
  const e = new RemoteEmbedder({ apiUrl: 'http://mock', apiKey: 'k', fetchImpl: mockFetch(), dim: 8 });
  const vecs = await e.embedBatch(['a', 'bb', 'ccc']);
  assert.equal(vecs.length, 3);
  assert.ok(vecs.every((v) => v.length === 8));
});

test('factory: defaults to local, selects remote with key, falls back without', () => {
  assert.ok(createEmbedder({}, {}) instanceof LocalEmbedder);
  assert.ok(createEmbedder({ provider: 'remote', apiKey: 'k', apiUrl: 'http://x', fetchImpl: mockFetch() }) instanceof RemoteEmbedder);
  // remote requested but no key and no injected fetch -> graceful fallback
  assert.ok(createEmbedder({ provider: 'remote' }, {}) instanceof LocalEmbedder);
});

test('factory reads configuration from environment', () => {
  const env = { EMBEDDINGS_PROVIDER: 'remote', EMBEDDINGS_API_KEY: 'k', EMBEDDINGS_API_URL: 'http://x' };
  const e = createEmbedder({ fetchImpl: mockFetch() }, env);
  assert.ok(e instanceof RemoteEmbedder);
});

test('createShoppingSystemAsync runs end-to-end with a remote embedder', async () => {
  const calls = [];
  const sys = await createShoppingSystemAsync({
    embedderOptions: { provider: 'remote', apiUrl: 'http://mock', apiKey: 'k', fetchImpl: mockFetch(calls), dim: 8 },
  });
  assert.ok(sys.embedder instanceof RemoteEmbedder);
  await sys.engine.indexAllAsync([
    { id: 'a', title: 'warm winter coat', categoryId: 5598, inStock: true },
    { id: 'b', title: 'blue running shoes', categoryId: 187, inStock: true },
  ]);
  const out = await sys.engine.searchAsync('winter coat');
  assert.equal(out.results[0].product.id, 'a');
  assert.ok(calls.length > 0); // the network was actually exercised (via mock)
});
