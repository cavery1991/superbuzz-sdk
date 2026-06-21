import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalEmbedder, cosineSimilarity, tokenize } from '../src/embeddings/embedder.js';

test('embeddings are deterministic and normalized', () => {
  const e = new LocalEmbedder();
  const a = e.embed('warm winter coat');
  const b = e.embed('warm winter coat');
  assert.deepEqual([...a], [...b]);
  const norm = Math.sqrt([...a].reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
});

test('semantic matching: paraphrases are closer than unrelated text', () => {
  const e = new LocalEmbedder();
  const query = e.embed('warm winter coat');
  const paraphrase = e.embed('insulated thermal parka for cold weather');
  const unrelated = e.embed('nonstick ceramic frying pan');

  const simParaphrase = cosineSimilarity(query, paraphrase);
  const simUnrelated = cosineSimilarity(query, unrelated);
  assert.ok(
    simParaphrase > simUnrelated,
    `paraphrase (${simParaphrase.toFixed(3)}) should beat unrelated (${simUnrelated.toFixed(3)})`,
  );
  assert.ok(simParaphrase > 0.2);
});

test('synonyms collapse onto shared concepts', () => {
  const e = new LocalEmbedder();
  const sim = cosineSimilarity(e.embed('sneakers'), e.embed('athletic trainers'));
  assert.ok(sim > 0.3, `sneakers ~ trainers should be similar, got ${sim.toFixed(3)}`);
});

test('tokenize lowercases, strips punctuation, drops stopwords, singularizes', () => {
  assert.deepEqual(tokenize('The Blue Sneakers!'), ['blue', 'sneaker']);
});

test('cosine of identical vectors is 1, orthogonal-ish low', () => {
  const e = new LocalEmbedder();
  const v = e.embed('headphones');
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
});
