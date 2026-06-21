/**
 * Competitive intelligence — where is a merchant losing to competitors?
 *
 * Shoppers don't see your catalog in isolation; they see it ranked against
 * everyone else's. This module reuses the existing semantic engine to answer
 * three competitive questions over the same Shopping Graph the search layer
 * ranks against:
 *
 *   - shareOfVoice : across a set of demand queries, how often do *your*
 *     products actually surface in the top-k semantic results vs. competitors'?
 *     A low share means rivals own the intent you want.
 *   - priceComparison : per category, where does your price sit relative to the
 *     competition — cheaper, similar, or pricier — and by how much?
 *   - titleGaps : which terms do competitors put in their titles (in the same
 *     category) that you're missing? These are the keyword gaps that cost you
 *     relevance and impressions.
 *
 * Everything is computed from already-indexed product embeddings and the
 * engine's query parser/embedder, so the competitive read uses the exact same
 * semantic space the search engine ranks in.
 */

import { cosineSimilarity, tokenize } from '../embeddings/embedder.js';

/**
 * @typedef {object} ShareOfVoicePerQuery
 * @property {string} query        the demand query that was scored
 * @property {string[]} topIds     ids of the top-k products for the query
 * @property {number} ownInTopK    how many of the top-k ids belong to the merchant
 * @property {number} total        the k that was requested (denominator)
 */

/**
 * @typedef {object} ShareOfVoiceResult
 * @property {number} overall                  blended share of voice in [0,1]
 * @property {ShareOfVoicePerQuery[]} perQuery per-query breakdown
 */

/**
 * Share of voice: across a set of demand queries, measure how often the
 * merchant's own products surface in the top-k semantic results vs. all
 * products in the graph.
 *
 * For each query the query's intent-expanded text is embedded (via the engine's
 * parser + embedder) and every indexed product in `engine.graph` is scored by
 * cosine similarity against that vector. The top-k product ids are taken and the
 * number belonging to `ownIds` is counted. The overall figure is the total own
 * appearances divided by the total slots scored (sum of k across queries).
 *
 * @param {object} params
 * @param {import('../search/search-engine.js').SearchEngine} params.engine semantic engine (provides parser, embedder, graph)
 * @param {string[]} params.queries demand queries to evaluate share of voice over
 * @param {Set<string>|string[]} params.ownIds ids of products owned by the merchant
 * @param {number} [params.k=3] how many top results count as "voice" per query
 * @returns {ShareOfVoiceResult}
 */
export function shareOfVoice({ engine, queries, ownIds, k = 3 }) {
  const own = ownIds instanceof Set ? ownIds : new Set(ownIds ?? []);
  const products = engine.graph.all().filter((p) => p.embedding);

  const perQuery = [];
  let ownTotal = 0;
  let slotTotal = 0;

  for (const query of queries ?? []) {
    const queryVec = engine.embedder.embed(engine.parser.parse(query).semanticText);

    const ranked = products
      .map((p) => ({ id: p.id, score: cosineSimilarity(queryVec, p.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    const topIds = ranked.map((r) => r.id);
    const ownInTopK = topIds.reduce((n, id) => n + (own.has(id) ? 1 : 0), 0);

    ownTotal += ownInTopK;
    slotTotal += k;
    perQuery.push({ query, topIds, ownInTopK, total: k });
  }

  const overall = slotTotal > 0 ? ownTotal / slotTotal : 0;
  return { overall, perQuery };
}

/**
 * @typedef {object} PriceComparison
 * @property {number|null} ownMedian        median own price in the category (null if none priced)
 * @property {number|null} competitorMedian median competitor price in the category (null if none priced)
 * @property {'cheaper'|'similar'|'pricier'|'unknown'} position where own price sits vs. competitors
 * @property {number|null} delta            ownMedian - competitorMedian (null when unknown)
 */

/** Categories whose own/competitor medians are within this band count as "similar". */
const SIMILAR_BAND = 0.05;

/**
 * Per-category price comparison between the merchant's catalog and competitors'.
 *
 * Products are bucketed by `categoryId`; within each bucket the median own price
 * and median competitor price are compared. A category is `similar` when the own
 * median is within ±5% of the competitor median, `cheaper`/`pricier` otherwise,
 * and `unknown` when either side has no priced products. Null/non-numeric prices
 * are ignored.
 *
 * @param {object} params
 * @param {Array<{categoryId?:number|null, price?:number|null}>} params.ownProducts
 * @param {Array<{categoryId?:number|null, price?:number|null}>} params.competitorProducts
 * @returns {Map<number, PriceComparison>} categoryId -> comparison
 */
export function priceComparison({ ownProducts, competitorProducts }) {
  const ownByCat = pricesByCategory(ownProducts);
  const compByCat = pricesByCategory(competitorProducts);

  /** @type {Map<number, PriceComparison>} */
  const out = new Map();
  const categories = new Set([...ownByCat.keys(), ...compByCat.keys()]);

  for (const categoryId of categories) {
    const ownMedian = median(ownByCat.get(categoryId));
    const competitorMedian = median(compByCat.get(categoryId));

    let position = /** @type {PriceComparison['position']} */ ('unknown');
    let delta = null;
    if (ownMedian != null && competitorMedian != null) {
      delta = ownMedian - competitorMedian;
      const band = competitorMedian * SIMILAR_BAND;
      if (Math.abs(delta) <= band) position = 'similar';
      else position = delta < 0 ? 'cheaper' : 'pricier';
    }

    out.set(categoryId, { ownMedian, competitorMedian, position, delta });
  }

  return out;
}

/**
 * Title gaps: terms that appear frequently in competitor titles for the same
 * category but are missing from the merchant's own product title.
 *
 * Only competitors sharing the own product's `categoryId` are considered. Both
 * sides are tokenized with the shared {@link tokenize}, so the comparison
 * matches the search engine's notion of words (stopwords dropped, light
 * singularization). Candidate tokens are ranked by how many competitor titles
 * contain them (document frequency), and any token already present in the own
 * title is excluded. Up to `top` tokens are returned.
 *
 * @param {object} params
 * @param {{title?:string, categoryId?:number|null}} params.ownProduct
 * @param {Array<{title?:string, categoryId?:number|null}>} params.competitorProducts
 * @param {number} [params.top=8] maximum number of gap tokens to return
 * @returns {string[]} gap tokens ordered by descending competitor frequency
 */
export function titleGaps({ ownProduct, competitorProducts, top = 8 }) {
  const ownTokens = new Set(tokenize(ownProduct?.title ?? ''));
  const categoryId = ownProduct?.categoryId;

  /** @type {Map<string, number>} token -> number of competitor titles containing it */
  const freq = new Map();
  for (const comp of competitorProducts ?? []) {
    if (comp?.categoryId !== categoryId) continue;
    const unique = new Set(tokenize(comp?.title ?? ''));
    for (const tok of unique) {
      if (ownTokens.has(tok)) continue;
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([tok]) => tok);
}

/**
 * Bucket products' usable prices by categoryId.
 * @param {Array<{categoryId?:number|null, price?:number|null}>} products
 * @returns {Map<number, number[]>}
 */
function pricesByCategory(products) {
  /** @type {Map<number, number[]>} */
  const byCategory = new Map();
  for (const p of products ?? []) {
    if (p?.categoryId == null) continue;
    const price = priceOf(p);
    if (price == null) continue;
    if (!byCategory.has(p.categoryId)) byCategory.set(p.categoryId, []);
    byCategory.get(p.categoryId).push(price);
  }
  return byCategory;
}

/**
 * Median of a numeric array, or null when empty/missing.
 * @param {number[]|undefined} values
 * @returns {number|null}
 */
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Extract a usable price from a product, or null if missing/non-positive.
 * @param {{price?:number|null}} product
 * @returns {number|null}
 */
function priceOf(product) {
  const price = product?.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return price;
}
