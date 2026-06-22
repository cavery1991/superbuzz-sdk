import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createShoppingSystemAsync, analyzeFeedAsync, runWarmed, predictAppearance, calibrateThresholds,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(resolve(__dirname, '../data/feed.sample.json'), 'utf8');
const TERMS = readFileSync(resolve(__dirname, '../data/search-terms.sample.csv'), 'utf8');
const PRODUCTS = JSON.parse(readFileSync(resolve(__dirname, '../data/products.enriched.json'), 'utf8'));
const JUDGMENTS = JSON.parse(readFileSync(resolve(__dirname, '../data/relevance.sample.json'), 'utf8'));

/** A deterministic async "neural" model: same text → same 32-dim vector. */
function fakeNeural() {
  return async () => async (texts) => {
    const list = texts.map((t) => {
      const v = new Array(32).fill(0.01);
      for (let i = 0; i < t.length; i++) v[t.charCodeAt(i) % 32] += 1;
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
    return { tolist: () => list };
  };
}

const opts = () => ({ embedderOptions: { provider: 'neural', pipelineFactory: fakeNeural() } });

test('createShoppingSystemAsync builds a working neural-backed system', async () => {
  const sys = await createShoppingSystemAsync(opts());
  assert.equal(sys.embedder.constructor.name, 'NeuralEmbedder');
  assert.equal(sys.embedder.dim, 32); // learned from the fake model output
});

test('analyzeFeedAsync drives the sync analyzer to a fixpoint over an async embedder', async () => {
  const sys = await createShoppingSystemAsync(opts());
  const report = await analyzeFeedAsync({ feed: FEED, searchTermsCsv: TERMS, system: sys });
  // Completed without any "not warmed" error and produced a structurally valid report.
  assert.equal(report.summary.products, 6);
  assert.ok(report.products.every((p) => p.price && p.compliance && p.simulation));
  assert.ok(report.summary.estimatedLift.wellAfter >= report.summary.estimatedLift.wellBefore);
});

test('runWarmed lets a sync predict/calibrate run on async embeddings', async () => {
  const sys = await createShoppingSystemAsync(opts());

  const out = await runWarmed({
    inner: sys.embedder,
    taxonomy: sys.taxonomy,
    run: (s) => {
      s.engine.indexAll(PRODUCTS);
      return predictAppearance({ engine: s.engine, query: 'warm winter coat', appearThreshold: 0.5 });
    },
  });
  assert.ok(out.rows.length === PRODUCTS.length);
  assert.ok(['appears', 'borderline', 'absent', 'ineligible'].includes(out.rows[0].verdict));

  // And calibration runs end-to-end on the async embedder.
  const cal = await runWarmed({
    inner: sys.embedder,
    taxonomy: sys.taxonomy,
    run: (s) => { s.engine.indexAll(PRODUCTS); return calibrateThresholds(s.engine, JUDGMENTS); },
  });
  assert.ok(cal.recommended.well >= cal.recommended.weak);
  assert.ok(cal.recommended.well >= 0 && cal.recommended.well <= 1);
});
