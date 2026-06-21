/**
 * Public API for the Shopping Graph system.
 *
 * A compact re-implementation of the ideas behind Google Shopping:
 *   - Google Product Category (GPC) taxonomy — the "number system"
 *   - semantic vector embeddings — meaning-based matching, not keyword matching
 *   - the Shopping Graph — a product store understanding structured attributes
 *   - a semantic SearchEngine that operates over all three
 *
 * Quick start:
 *
 *   import { createShoppingSystem } from 'shopping-graph';
 *   const sys = createShoppingSystem();
 *   sys.engine.index({ id: '1', title: 'Insulated Down Parka', brand: 'NorthPeak',
 *                      attributes: { color: 'navy' }, inStock: true });
 *   const { results } = sys.engine.search('warm winter coat');
 */

import { Taxonomy } from './taxonomy/taxonomy.js';
import { LocalEmbedder, Embedder, cosineSimilarity } from './embeddings/embedder.js';
import { ShoppingGraph } from './graph/shopping-graph.js';
import { CategoryClassifier } from './search/classifier.js';
import { SearchEngine } from './search/search-engine.js';

export { Taxonomy } from './taxonomy/taxonomy.js';
export { LocalEmbedder, Embedder, cosineSimilarity, tokenize } from './embeddings/embedder.js';
export { ShoppingGraph } from './graph/shopping-graph.js';
export { CategoryClassifier } from './search/classifier.js';
export { SearchEngine } from './search/search-engine.js';
export { CONCEPTS } from './embeddings/concepts.js';
export { QueryParser } from './query/query-parser.js';
export { buildProductProfile } from './product/profile.js';
export { applyContext, CoPurchaseModel } from './ranking/context.js';
export { ingestFeed, ingestSearchTerms } from './feed/feed-ingest.js';
export { buildQueryUniverse } from './feed/query-universe.js';
export { auditProduct } from './feed/auditor.js';
export { optimizeProduct } from './feed/optimizer.js';
export { analyzeFeed } from './feed/analyzer.js';

/**
 * Wire up a complete, ready-to-use shopping system.
 * @param {object} [opts]
 * @param {Taxonomy} [opts.taxonomy]  defaults to the bundled curated subset
 * @param {Embedder} [opts.embedder]  defaults to the offline LocalEmbedder
 * @param {object} [opts.weights]     scoring weight overrides for the engine
 * @returns {{taxonomy:Taxonomy, embedder:Embedder, graph:ShoppingGraph, classifier:CategoryClassifier, engine:SearchEngine}}
 */
export function createShoppingSystem(opts = {}) {
  const taxonomy = opts.taxonomy ?? Taxonomy.sample();
  const embedder = opts.embedder ?? new LocalEmbedder();
  const graph = new ShoppingGraph();
  const engine = new SearchEngine({ taxonomy, embedder, graph, weights: opts.weights });
  return { taxonomy, embedder, graph, classifier: engine.classifier, engine };
}
