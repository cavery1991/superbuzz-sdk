/**
 * Run a *synchronous* analysis (analyzeFeed, predict, calibrate) on top of an
 * *asynchronous* embedder (neural / remote).
 *
 * The engine embeds synchronously, but neural/remote models fetch vectors
 * asynchronously — and we can't simply pre-warm a fixed list, because which
 * texts get embedded depends on embedding *values* (e.g. category classification
 * changes which queries are generated). So we drive it to a fixpoint:
 *
 *   1. Wrap the real embedder in a CollectingEmbedder: on a cache miss it records
 *      the text and returns a zero vector instead of throwing.
 *   2. Run the sync analysis. It completes (on garbage where uncached) and we
 *      collect every text it touched.
 *   3. Warm those texts on the real embedder, and repeat. Within a couple of
 *      passes the collected set stabilizes (classification becomes correct, the
 *      real query set appears, etc.).
 *   4. A final strict pass (misses now throw) runs on a fully-warmed cache and
 *      returns the correct result.
 *
 * Net cost: each unique text is embedded by the real model exactly once.
 */

import { LocalEmbedder } from './embedder.js';
import { ShoppingGraph } from '../graph/shopping-graph.js';
import { SearchEngine } from '../search/search-engine.js';

export class CollectingEmbedder {
  constructor(inner) {
    this.inner = inner;
    this.misses = new Set();
    this.strict = false;
  }

  get dim() {
    return this.inner.dim;
  }

  embed(text) {
    try {
      return this.inner.embed(text);
    } catch (err) {
      if (this.strict) throw err;
      this.misses.add(text);
      return new Float64Array(this.inner.dim);
    }
  }

  async warm(texts) {
    return this.inner.warm(texts);
  }

  async embedBatch(texts) {
    await this.warm(texts);
    return texts.map((t) => this.embed(t));
  }
}

/** Build a fresh system (new graph + engine) bound to a given embedder. */
export function buildSystemWith(taxonomy, embedder, weights) {
  const graph = new ShoppingGraph();
  const engine = new SearchEngine({ taxonomy, embedder, graph, weights });
  return { taxonomy, embedder, graph, classifier: engine.classifier, engine };
}

/**
 * Drive a sync analysis to a fixpoint over an async embedder.
 * @param {object} args
 * @param {import('./embedder.js').Embedder} args.inner  the real embedder (its
 *   category vectors should already be warmed, e.g. via createShoppingSystemAsync)
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @param {(system:object) => any} args.run  the sync analysis, given a fresh system
 * @param {object} [args.weights]
 * @param {number} [args.maxPasses=8]
 * @returns {Promise<any>} the result of the final, fully-warmed run
 */
export async function runWarmed({ inner, taxonomy, run, weights, maxPasses = 8 }) {
  // A synchronous embedder needs no warming — just run once.
  if (inner instanceof LocalEmbedder) {
    return run(buildSystemWith(taxonomy, inner, weights));
  }

  const collector = new CollectingEmbedder(inner);
  for (let pass = 0; pass < maxPasses; pass++) {
    collector.misses.clear();
    run(buildSystemWith(taxonomy, collector, weights));
    if (collector.misses.size === 0) break;
    await inner.warm([...collector.misses]);
  }

  // Final correct pass: everything is warmed; misses now surface as errors.
  collector.strict = true;
  return run(buildSystemWith(taxonomy, collector, weights));
}
