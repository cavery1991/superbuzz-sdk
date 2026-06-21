/**
 * Evaluation & validation harness.
 *
 * Turns "is the tool any good?" from eyeballing into measurement:
 *
 *   - evaluate()                  retrieval quality (precision/recall/MRR/NDCG@k)
 *                                  against labeled query → relevant-product judgments.
 *   - calibrateThresholds()       sweep the cosine threshold against those labels
 *                                  to pick data-driven well/weak coverage cutoffs,
 *                                  instead of hand-chosen constants.
 *   - validateAgainstPerformance() the core back-test: do queries the tool flags
 *                                  as weakly/uncovered actually underperform in the
 *                                  merchant's real Search Terms data? If "well"
 *                                  queries don't out-earn "gap" queries, the
 *                                  coverage signal isn't predictive — and you know it.
 */

import { cosineSimilarity } from '../embeddings/embedder.js';

/** Score a query against every indexed product (semantic cosine). */
function scoreAll(engine, query) {
  const vec = engine.embedder.embed(engine.parser.parse(query).semanticText);
  return engine.graph.all().map((p) => ({
    id: p.id,
    score: p.embedding ? cosineSimilarity(vec, p.embedding) : 0,
  }));
}

/**
 * Retrieval metrics over labeled judgments.
 * @param {import('../search/search-engine.js').SearchEngine} engine
 * @param {Array<{query:string, relevant:string[]}>} judgments
 * @param {object} [opts] @param {number} [opts.k=5]
 */
export function evaluate(engine, judgments, { k = 5 } = {}) {
  const per = judgments.map((j) => {
    const ranked = scoreAll(engine, j.query).sort((a, b) => b.score - a.score);
    const rel = new Set(j.relevant);
    return { query: j.query, ...metricsFor(ranked, rel, k) };
  });
  const avg = (sel) => round(mean(per.map(sel)));
  return {
    k,
    queries: per.length,
    precisionAtK: avg((m) => m.precision),
    recallAtK: avg((m) => m.recall),
    mrr: avg((m) => m.rr),
    ndcgAtK: avg((m) => m.ndcg),
    perQuery: per,
  };
}

function metricsFor(ranked, rel, k) {
  const topK = ranked.slice(0, k);
  const hits = topK.filter((r) => rel.has(r.id)).length;
  const precision = hits / k;
  const recall = rel.size ? hits / rel.size : 0;

  let rr = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (rel.has(ranked[i].id)) { rr = 1 / (i + 1); break; }
  }

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) if (rel.has(topK[i].id)) dcg += 1 / Math.log2(i + 2);
  let idcg = 0;
  for (let i = 0; i < Math.min(rel.size, k); i++) idcg += 1 / Math.log2(i + 2);
  const ndcg = idcg ? dcg / idcg : 0;

  return { precision, recall, rr, ndcg };
}

/**
 * Calibrate coverage thresholds against labeled relevance: at each candidate
 * cosine cutoff, how well does "score ≥ t" predict "actually relevant"?
 * @returns {{ recommended:{well:number, weak:number}, best:object, curve:object[] }}
 */
export function calibrateThresholds(engine, judgments, { steps = 20 } = {}) {
  const pairs = [];
  for (const j of judgments) {
    const rel = new Set(j.relevant);
    for (const s of scoreAll(engine, j.query)) pairs.push({ score: s.score, rel: rel.has(s.id) });
  }

  const curve = [];
  let best = { f1: -1, t: 0.5 };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = prf(pairs, t);
    const row = { t: round(t), ...m };
    curve.push(row);
    if (m.f1 > best.f1) best = row;
  }
  // Weak cutoff: a more permissive boundary *below* "well" that still catches
  // nearly all relevants (a softer "somewhat relevant" line).
  const well = best.t;
  const weakCandidates = curve.filter((c) => c.t < well && c.recall >= 0.95).map((c) => c.t);
  const weak = weakCandidates.length ? Math.max(...weakCandidates) : round(well / 2);

  return { recommended: { well, weak: round(weak) }, best, curve };
}

function prf(pairs, t) {
  let tp = 0, fp = 0, fn = 0;
  for (const p of pairs) {
    const pred = p.score >= t;
    if (pred && p.rel) tp++;
    else if (pred && !p.rel) fp++;
    else if (!pred && p.rel) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

/**
 * Back-test the coverage signal against real performance: bucket each real
 * search term by predicted coverage, then check whether better-covered queries
 * actually earned more (clicks/conversions/value).
 * @param {import('../search/search-engine.js').SearchEngine} engine
 * @param {Array<{query:string, value?:number, clicks?:number, conversions?:number}>} searchTerms
 * @param {object} [opts] @param {number} [opts.well=0.45] @param {number} [opts.weak=0.2] @param {string} [opts.metric='conversions']
 */
export function validateAgainstPerformance(engine, searchTerms, { well = 0.45, weak = 0.2, metric = 'conversions' } = {}) {
  const rows = searchTerms.map((t) => {
    const best = Math.max(0, ...scoreAll(engine, t.query).map((s) => s.score));
    const bucket = best >= well ? 'well' : best >= weak ? 'weak' : 'gap';
    const perf = t[metric] ?? t.value ?? 0;
    return { query: t.query, bestScore: round(best), bucket, perf };
  });

  const summary = {};
  for (const b of ['well', 'weak', 'gap']) {
    const arr = rows.filter((r) => r.bucket === b).map((r) => r.perf);
    summary[b] = { n: arr.length, avgPerf: round(mean(arr)) };
  }

  const correlation = round(pearson(rows.map((r) => r.bestScore), rows.map((r) => r.perf)));
  // The hypothesis: predicted coverage tracks real performance.
  const holds = (summary.well.avgPerf || 0) >= (summary.gap.avgPerf || 0) && correlation >= 0;

  return { metric, thresholds: { well, weak }, rows, summary, correlation, holds };
}

function mean(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

function pearson(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
