/**
 * Revenue attribution — translate feed-optimization opportunities into
 * projected incremental MONTHLY revenue, so recommendations can be ranked by
 * dollars instead of abstract "coverage" counts.
 *
 * The model is deliberately simple and transparent (the inputs a merchant can
 * actually reason about), not a forecasting engine:
 *
 *   A query the catalog covers weakly today is worth fixing because, once the
 *   feed change lands, the product starts ranking for it. We model the upside
 *   as an "incremental clicks" estimate scaled by a conversion rate and the
 *   average order value:
 *
 *     incrementalClicks = clicks>0 ? clicks*positionLift
 *                                  : impressions*ctr*positionLift
 *     convRate          = (conversions>0 && clicks>0) ? conversions/clicks
 *                                                     : conversionRate
 *     revenue           = incrementalClicks * convRate * avgOrderValue
 *
 * `positionLift` is the fraction of additional clicks the fix is assumed to
 * win (e.g. 0.3 ≈ a 30% click uplift). When we have observed clicks we lift
 * those directly; otherwise we synthesize a click estimate from impressions
 * and an assumed CTR. Likewise we prefer the query's own observed conversion
 * rate (conversions/clicks) and only fall back to the default `conversionRate`
 * when we lack the data to compute it. All figures are MONTHLY and assume the
 * input metrics represent a typical month.
 */

/**
 * Estimate the incremental MONTHLY revenue a feed fix would unlock for a single
 * query, given its observed (or assumed) traffic metrics.
 *
 * Assumptions:
 *  - Input metrics (impressions/clicks/conversions) represent one month.
 *  - `positionLift` is the share of incremental clicks the fix wins.
 *  - Observed conversion rate (conversions/clicks) is used when available;
 *    otherwise the `conversionRate` default applies.
 *  - When clicks are unknown, clicks are synthesized as impressions*ctr.
 *
 * @param {object} args
 * @param {number} [args.impressions=0]     monthly impressions for the query
 * @param {number} [args.clicks=0]          monthly clicks for the query
 * @param {number} [args.conversions=0]     monthly conversions for the query
 * @param {number} [args.avgOrderValue=80]  average order value in currency units
 * @param {number} [args.conversionRate=0.02] fallback conversion rate (0..1)
 * @param {number} [args.ctr=0.01]          fallback click-through rate (0..1)
 * @param {number} [args.positionLift=0.3]  fraction of clicks the fix adds
 * @returns {number} estimated incremental monthly revenue, rounded to cents
 */
export function projectedRevenue({
  impressions = 0,
  clicks = 0,
  conversions = 0,
  avgOrderValue = 80,
  conversionRate = 0.02,
  ctr = 0.01,
  positionLift = 0.3,
} = {}) {
  const incrementalClicks = clicks > 0 ? clicks * positionLift : impressions * ctr * positionLift;
  const convRate = conversions > 0 && clicks > 0 ? conversions / clicks : conversionRate;
  const revenue = incrementalClicks * convRate * avgOrderValue;
  return round2(revenue);
}

/**
 * Project incremental revenue for a list of opportunities and rank them by
 * dollars. Does not mutate the input; returns a new array of new objects.
 *
 * Each opportunity is expected to carry traffic metrics (impressions, clicks,
 * conversions) and an optional `wouldFix` flag. Opportunities where
 * `wouldFix === false` are kept but scored at 0 — a fix that doesn't actually
 * close the gap earns no projected revenue.
 *
 * @param {Array<object>} opportunities  rows with {query, impressions, clicks,
 *                                        conversions, wouldFix, ...}
 * @param {object} [opts]                forwarded model params
 * @param {number} [opts.avgOrderValue]
 * @param {number} [opts.conversionRate]
 * @param {number} [opts.ctr]
 * @param {number} [opts.positionLift]
 * @returns {Array<object>} new array, each item with a `projectedRevenue`
 *                          field, sorted descending by projectedRevenue
 */
export function estimateOpportunities(opportunities, opts = {}) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  const { avgOrderValue, conversionRate, ctr, positionLift } = opts;
  return list
    .map((item) => {
      const revenue = item.wouldFix === false
        ? 0
        : projectedRevenue({
            impressions: item.impressions,
            clicks: item.clicks,
            conversions: item.conversions,
            avgOrderValue,
            conversionRate,
            ctr,
            positionLift,
          });
      return { ...item, projectedRevenue: revenue };
    })
    .sort((a, b) => b.projectedRevenue - a.projectedRevenue);
}

/**
 * Roll up a set of estimated opportunities into headline totals.
 *
 * @param {Array<object>} estimated  output of {@link estimateOpportunities}
 * @returns {{totalMonthly:number, totalAnnual:number,
 *            top:Array<{query:string, projectedRevenue:number}>}}
 *          monthly + annual (12x) totals and the top 5 by projected revenue
 */
export function summarizeRevenue(estimated) {
  const list = Array.isArray(estimated) ? estimated : [];
  const totalMonthly = round2(list.reduce((s, it) => s + (it.projectedRevenue || 0), 0));
  const totalAnnual = round2(totalMonthly * 12);
  const top = [...list]
    .sort((a, b) => (b.projectedRevenue || 0) - (a.projectedRevenue || 0))
    .slice(0, 5)
    .map((it) => ({ query: it.query, projectedRevenue: it.projectedRevenue || 0 }));
  return { totalMonthly, totalAnnual, top };
}

/** Round a currency amount to cents. */
function round2(n) {
  return Math.round(n * 100) / 100;
}
