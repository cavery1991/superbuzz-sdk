/**
 * Real-time contextual re-ranking.
 *
 * The final match score is not static — it is weighted by the user's situation:
 *
 *   - Geographic location : prioritize products with nearby local inventory.
 *   - Device / interface  : on mobile, boost items offering in-store pickup today.
 *   - Co-purchasing data  : nudge the query vector toward what other shoppers
 *                            actually bought after this exact search.
 *
 * This operates as a post-pass over the engine's semantic results so the base
 * relevance score stays interpretable and the contextual deltas are explicit.
 */

const CONTEXT_WEIGHTS = {
  geo: 0.15, // local availability near the shopper
  pickup: 0.1, // in-store pickup today (mobile)
  coPurchase: 0.2, // historical co-purchase affinity for this query
};

/**
 * A tiny co-purchase model: query -> { productId: affinity (0..1) }.
 * In production this is learned from session logs; here it is supplied/seeded.
 */
export class CoPurchaseModel {
  constructor(table = {}) {
    /** @type {Map<string, Map<string,number>>} */
    this.table = new Map();
    for (const [q, prods] of Object.entries(table)) this.set(q, prods);
  }

  set(query, products) {
    this.table.set(normalize(query), new Map(Object.entries(products)));
  }

  /** Record that `productId` was purchased after `query` (incremental learning). */
  observe(query, productId, weight = 1) {
    const key = normalize(query);
    if (!this.table.has(key)) this.table.set(key, new Map());
    const row = this.table.get(key);
    row.set(productId, (row.get(productId) ?? 0) + weight);
  }

  /** Affinity in 0..1 for a product given a query (max-normalized per query). */
  affinity(query, productId) {
    const row = this.table.get(normalize(query));
    if (!row || row.size === 0) return 0;
    const max = Math.max(...row.values());
    return max > 0 ? (row.get(productId) ?? 0) / max : 0;
  }
}

/**
 * Re-rank semantic results using real-time context.
 * @param {Array<{product:object, score:number, breakdown?:object}>} results
 * @param {object} [context]
 * @param {string} [context.region]        shopper region/locale code
 * @param {'mobile'|'desktop'|'tablet'} [context.device]
 * @param {string} [context.query]         original query (for co-purchase lookup)
 * @param {CoPurchaseModel} [context.coPurchase]
 * @param {object} [weights]
 * @returns {Array} re-ranked results with `contextScore` and updated `score`
 */
export function applyContext(results, context = {}, weights = {}) {
  const w = { ...CONTEXT_WEIGHTS, ...weights };
  const { region, device, query, coPurchase } = context;

  const adjusted = results.map((r) => {
    const p = r.product;
    let geo = 0;
    let pickup = 0;
    let coPurchaseScore = 0;

    // Geo: product carries optional `localInventory: { [region]: units }`.
    if (region && p.localInventory && p.localInventory[region] > 0) geo = 1;

    // Device: mobile shoppers favor "in-store pickup today".
    if (device === 'mobile' && p.pickupToday) pickup = 1;

    // Co-purchase affinity for this exact query.
    if (coPurchase && query) coPurchaseScore = coPurchase.affinity(query, p.id);

    const contextDelta = w.geo * geo + w.pickup * pickup + w.coPurchase * coPurchaseScore;

    return {
      ...r,
      score: r.score + contextDelta,
      contextScore: contextDelta,
      contextBreakdown: { geo, pickup, coPurchase: coPurchaseScore },
    };
  });

  adjusted.sort((a, b) => b.score - a.score);
  return adjusted;
}

function normalize(q) {
  return String(q).toLowerCase().replace(/\s+/g, ' ').trim();
}
