/**
 * Price intelligence.
 *
 * Shoppers compare. So does the Shopping Graph: a listing's price is only
 * meaningful relative to the going rate for similar products. This module builds
 * per-category price benchmarks from the catalog, then scores any individual
 * product against the market it competes in.
 *
 * The output is twofold:
 *   - a human-readable competitiveness read (where this price sits, how far from
 *     the median, an above-market penalty), and
 *   - a single 0..1 ranking feature the search/re-ranking layers can fold in,
 *     where more competitively-priced listings score higher.
 *
 * Benchmarks are keyed by categoryId. A catalog-wide benchmark is stored under
 * the key `'overall'` and used as a fallback when a product's category has no
 * benchmark of its own (e.g. an unseen or sparsely-populated category).
 */

/** Key under which the catalog-wide fallback benchmark is stored. */
export const OVERALL_KEY = 'overall';

/**
 * @typedef {object} Benchmark
 * @property {number} count   number of priced products in the bucket
 * @property {number} min
 * @property {number} p25
 * @property {number} median
 * @property {number} p75
 * @property {number} max
 * @property {number} mean
 */

/**
 * Build per-category price benchmarks from a set of normalized products.
 *
 * Products with a null, non-numeric, or zero/negative price are ignored. Each
 * category with at least one priced product gets an entry keyed by its
 * categoryId; a catalog-wide entry is stored under {@link OVERALL_KEY} as a
 * fallback for categories that have no benchmark of their own.
 *
 * @param {Array<{categoryId?:number|null, price?:number|null}>} products
 * @returns {Map<number|string, Benchmark>} categoryId|'overall' -> Benchmark
 */
export function buildPriceBenchmarks(products) {
  /** @type {Map<number, number[]>} */
  const byCategory = new Map();
  const all = [];

  for (const p of products ?? []) {
    const price = priceOf(p);
    if (price == null) continue;
    all.push(price);
    if (p.categoryId != null) {
      if (!byCategory.has(p.categoryId)) byCategory.set(p.categoryId, []);
      byCategory.get(p.categoryId).push(price);
    }
  }

  /** @type {Map<number|string, Benchmark>} */
  const benchmarks = new Map();
  for (const [categoryId, prices] of byCategory) {
    benchmarks.set(categoryId, summarize(prices));
  }
  if (all.length > 0) benchmarks.set(OVERALL_KEY, summarize(all));

  return benchmarks;
}

/**
 * Score a product's price against its market.
 *
 * Uses the benchmark for the product's category, falling back to the
 * catalog-wide benchmark when the category has none. `position` is 'competitive'
 * within +/-10% of the median, 'below' under 0.9x, 'above' over 1.1x, and
 * 'unknown' when there is no usable price or benchmark. The `penalty` rises with
 * how far above market the price is (0 unless above-market, clamped to 1) and
 * `score` is simply `1 - penalty`.
 *
 * @param {{categoryId?:number|null, price?:number|null}} product
 * @param {Map<number|string, Benchmark>} benchmarks
 * @returns {{
 *   hasBenchmark:boolean,
 *   marketMedian:number|null,
 *   ratioToMedian:number|null,
 *   percentile:number|null,
 *   position:'below'|'competitive'|'above'|'unknown',
 *   penalty:number,
 *   score:number
 * }}
 */
export function priceCompetitiveness(product, benchmarks) {
  const price = priceOf(product);
  const benchmark = resolveBenchmark(product, benchmarks);

  if (price == null || !benchmark) {
    return {
      hasBenchmark: Boolean(benchmark),
      marketMedian: benchmark ? benchmark.median : null,
      ratioToMedian: null,
      percentile: null,
      position: 'unknown',
      penalty: 0,
      score: 1,
    };
  }

  const median = benchmark.median;
  const ratioToMedian = median > 0 ? price / median : null;
  const percentile = percentileOf(price, product, benchmarks);

  let position = 'competitive';
  if (ratioToMedian != null) {
    if (ratioToMedian < 0.9) position = 'below';
    else if (ratioToMedian > 1.1) position = 'above';
  }

  // Penalty only for above-market prices: how far past the 1.1x line we are,
  // normalized so that ~2x median saturates to a full penalty.
  let penalty = 0;
  if (ratioToMedian != null && ratioToMedian > 1.1) {
    penalty = clamp01((ratioToMedian - 1.1) / 0.9);
  }

  return {
    hasBenchmark: true,
    marketMedian: median,
    ratioToMedian,
    percentile,
    position,
    penalty,
    score: clamp01(1 - penalty),
  };
}

/**
 * A 0..1 ranking feature derived from price competitiveness: more competitively
 * priced products score higher. Reuses {@link priceCompetitiveness}'s score, so
 * products with no price/benchmark are treated as neutral (1).
 *
 * @param {{categoryId?:number|null, price?:number|null}} product
 * @param {Map<number|string, Benchmark>} benchmarks
 * @returns {number} 0..1
 */
export function priceFeature(product, benchmarks) {
  return priceCompetitiveness(product, benchmarks).score;
}

/**
 * Pick the benchmark that applies to a product: its category's, else the
 * catalog-wide fallback.
 * @param {{categoryId?:number|null}} product
 * @param {Map<number|string, Benchmark>} benchmarks
 * @returns {Benchmark|null}
 */
function resolveBenchmark(product, benchmarks) {
  if (!benchmarks) return null;
  if (product?.categoryId != null && benchmarks.has(product.categoryId)) {
    return benchmarks.get(product.categoryId);
  }
  return benchmarks.get(OVERALL_KEY) ?? null;
}

/**
 * Rank a price within the prices used to build its applicable benchmark.
 * Returns null when no benchmark applies. Since benchmarks store summary stats
 * rather than raw prices, percentile is approximated from the quartile
 * breakpoints (min/p25/median/p75/max) via linear interpolation.
 * @param {number} price
 * @param {{categoryId?:number|null}} product
 * @param {Map<number|string, Benchmark>} benchmarks
 * @returns {number|null} 0..1, 0 = cheapest
 */
function percentileOf(price, product, benchmarks) {
  const b = resolveBenchmark(product, benchmarks);
  if (!b) return null;
  const points = [
    [b.min, 0],
    [b.p25, 0.25],
    [b.median, 0.5],
    [b.p75, 0.75],
    [b.max, 1],
  ];
  if (price <= b.min) return 0;
  if (price >= b.max) return 1;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (price <= x1) {
      if (x1 === x0) return y1;
      return y0 + ((price - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/**
 * Summary statistics (count, min/p25/median/p75/max, mean) for a list of prices.
 * @param {number[]} prices
 * @returns {Benchmark}
 */
function summarize(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

/**
 * Linear-interpolated percentile of an already-sorted array.
 * @param {number[]} sorted  ascending
 * @param {number} q  0..1
 * @returns {number}
 */
function percentile(sorted, q) {
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
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

/**
 * Clamp a number to the [0, 1] range.
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
