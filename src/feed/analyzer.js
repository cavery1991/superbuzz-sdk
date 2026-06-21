/**
 * Feed analyzer — the top-level operation for the merchant tool.
 *
 * Given a product feed (and optionally a real Search Terms report) it produces a
 * single combined report:
 *
 *   1. Coverage   — for every query in the universe, how well the catalog matches
 *                   it today (well-covered / weak / gap), value-weighted.
 *   2. Gaps       — high-value queries with no strong product match (opportunity).
 *   3. Per-product audit + recommendations — concrete feed fixes.
 *   4. Simulated lift — re-score after applying the recommendations to show the
 *                       relevance improvement each fix would deliver.
 *
 * It runs the feed through the semantic engine (the "Google's brain" simulator),
 * so coverage/match are estimated the same way the search side scores products.
 */

import { createShoppingSystem, cosineSimilarity } from '../index.js';
import { buildProductProfile } from '../product/profile.js';
import { buildPriceBenchmarks, priceCompetitiveness } from '../pricing/price-intel.js';
import { checkCompliance } from './compliance.js';
import { estimateOpportunities, summarizeRevenue } from '../revenue/attribution.js';
import { ingestFeed, ingestSearchTerms } from './feed-ingest.js';
import { buildQueryUniverse } from './query-universe.js';
import { auditProduct } from './auditor.js';
import { optimizeProduct } from './optimizer.js';

const THRESHOLDS = { well: 0.45, weak: 0.2 };

/**
 * @param {object} args
 * @param {string|object[]} args.feed       feed JSON/TSV string or parsed array
 * @param {string} [args.searchTermsCsv]    raw Search Terms report CSV
 * @param {object} [args.system]            an existing shopping system (else created)
 * @param {object} [args.thresholds]
 * @returns {object} the combined report
 */
export function analyzeFeed({ feed, searchTermsCsv, system, thresholds = {} } = {}) {
  const th = { ...THRESHOLDS, ...thresholds };
  const sys = system ?? createShoppingSystem();
  const { taxonomy, embedder, engine } = sys;

  // 1. Ingest feed; index products and capture their fused profiles.
  const items = ingestFeed(feed, taxonomy);
  const enriched = items.map((it) => {
    const profile = buildProductProfile({
      feed: it.product,
      schema: it.raw.schema,
      visionTags: it.raw.visionTags ?? splitList(it.raw.vision_tags),
      reviews: it.raw.reviews,
    });
    const stored = engine.index({ ...it.product });
    return { ...it, derivedTags: profile.derivedTags, derivedConcepts: profile.derivedConcepts, stored };
  });

  // 2. Build the query universe (real + generated).
  const searchTerms = searchTermsCsv ? ingestSearchTerms(searchTermsCsv) : [];
  const universe = buildQueryUniverse({
    products: enriched.map((e) => e.stored),
    taxonomy,
    searchTerms,
  });

  // Per-query performance metrics from the real report (for revenue attribution).
  const metricsByQuery = new Map(searchTerms.map((t) => [t.query.toLowerCase().trim(), t]));

  // Pre-embed every query once (with the engine's intent expansion).
  const queryVecs = universe.map((q) => ({
    ...q,
    ...(metricsByQuery.get(q.query.toLowerCase().trim()) ?? {}),
    query: q.query,
    value: q.value,
    vec: embedder.embed(engine.parser.parse(q.query).semanticText),
    categoryId: q.categoryId ?? engine.classifier.bestCategoryId(q.query),
  }));

  // 3. Audit + optimize every product first, so we have both the current and the
  //    optimized embedding to run a true before/after coverage simulation.
  const audited = enriched.map((e) => {
    const audit = auditProduct({
      raw: e.raw, provided: e.provided, product: e.stored,
      classifier: engine.classifier, taxonomy, derivedTags: e.derivedTags,
    });
    const opt = optimizeProduct({
      raw: e.raw, product: e.stored, audit, taxonomy,
      derivedTags: e.derivedTags, derivedConcepts: e.derivedConcepts,
    });
    return { e, audit, opt, optimizedVec: embedder.embed(opt.optimizedText) };
  });

  // 4. Catalog coverage, before vs after applying every recommendation.
  //    Coverage (queries matched at/above the "well" threshold), not raw cosine,
  //    is the metric that reflects whether feed optimization actually helps.
  const before = { well: 0, weak: 0, gap: 0, value: 0 };
  const after = { well: 0, weak: 0, gap: 0, value: 0 };
  const gapList = [];
  for (const q of queryVecs) {
    let bBest = -1, bId = null, aBest = -1;
    for (const a of audited) {
      const sb = cosineSimilarity(q.vec, a.e.stored.embedding);
      if (sb > bBest) { bBest = sb; bId = a.e.stored.id; }
      const sa = cosineSimilarity(q.vec, a.optimizedVec);
      if (sa > aBest) aBest = sa;
    }
    tally(before, bBest, q.value, th);
    tally(after, aBest, q.value, th);
    if (bBest < th.well) {
      gapList.push({
        query: q.query, value: q.value, source: q.source,
        bucket: bBest >= th.weak ? 'weak' : 'gap',
        bestScore: round(bBest), afterScore: round(aBest),
        wouldFix: bBest < th.well && aBest >= th.well,
        bestProductId: bId, categoryId: q.categoryId,
        impressions: q.impressions ?? 0, clicks: q.clicks ?? 0, conversions: q.conversions ?? 0,
      });
    }
  }
  gapList.sort((a, b) => Number(b.wouldFix) - Number(a.wouldFix) || b.value - a.value || a.bestScore - b.bestScore);

  // 5. Price benchmarks (per category) for competitiveness scoring.
  const benchmarks = buildPriceBenchmarks(enriched.map((e) => e.stored));

  // 6. Per-product report: feed score, recommendations, coverage lift, plus
  //    price competitiveness and policy/disapproval risk.
  const products = audited.map(({ e, audit, opt, optimizedVec }) => {
    const relevant = queryVecs.filter((q) => q.categoryId === (opt.suggestedCategoryId ?? e.stored.categoryId));
    let beforeCovered = 0, afterCovered = 0;
    for (const q of relevant) {
      if (cosineSimilarity(q.vec, e.stored.embedding) >= th.well) beforeCovered++;
      if (cosineSimilarity(q.vec, optimizedVec) >= th.well) afterCovered++;
    }
    const price = priceCompetitiveness(e.stored, benchmarks);
    const compliance = checkCompliance({ raw: e.raw, product: e.stored, taxonomy });
    return {
      id: e.stored.id,
      title: e.raw.title ?? '',
      feedScore: audit.score,
      issues: audit.issues,
      recommendations: opt.recommendations,
      price,
      compliance,
      simulation: {
        relevantQueries: relevant.length,
        beforeCovered, afterCovered,
        newlyCovered: Math.max(0, afterCovered - beforeCovered),
        suggestedTitle: opt.suggestedTitle,
      },
    };
  });
  products.sort((a, b) => a.feedScore - b.feedScore); // worst first (most opportunity)

  // 7. Revenue attribution: project incremental $ for fixable opportunities.
  const fixableOpps = gapList.filter((g) => g.wouldFix).map((g) => ({
    query: g.query,
    wouldFix: true,
    impressions: g.impressions ?? 0,
    clicks: g.clicks ?? 0,
    conversions: g.conversions ?? 0,
  }));
  const revenue = summarizeRevenue(estimateOpportunities(fixableOpps));

  const feedScoreSum = audited.reduce((s, a) => s + a.audit.score, 0);
  const atRisk = products.filter((p) => p.compliance.willLikelyDisapprove).length;
  const overMarket = products.filter((p) => p.price.position === 'above').length;

  return {
    summary: {
      products: enriched.length,
      categories: new Set(enriched.map((e) => e.stored.categoryId).filter((c) => c != null)).size,
      queryUniverse: {
        total: universe.length,
        real: universe.filter((q) => q.source === 'real').length,
        generated: universe.filter((q) => q.source === 'generated').length,
      },
      coverage: before,
      avgFeedScore: Math.round(feedScoreSum / (enriched.length || 1)),
      estimatedLift: {
        wellBefore: before.well,
        wellAfter: after.well,
        coverageGain: after.well - before.well,
        valueCoverageGainPct: pctOfTotal(after.value - before.value, before, after),
        queriesFixed: gapList.filter((g) => g.wouldFix).length,
      },
      revenue,
      compliance: { atRisk, ok: products.length - atRisk },
      pricing: { aboveMarket: overMarket },
      thresholds: th,
    },
    gaps: gapList.slice(0, 25),
    products,
  };
}

function tally(acc, best, value, th) {
  if (best >= th.well) { acc.well++; acc.value += value; }
  else if (best >= th.weak) acc.weak++;
  else acc.gap++;
}

function pctOfTotal(deltaValue, before) {
  const total = before.value || 1;
  return Math.round((deltaValue / total) * 100);
}

function splitList(v) {
  if (!v) return undefined;
  return String(v).split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
