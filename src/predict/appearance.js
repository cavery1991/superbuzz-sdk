/**
 * Appearance prediction — the central question: "for this search term, would this
 * product appear, and if not, why, and what would make it?"
 *
 * A product appearing on Google Shopping for a query is the conjunction of:
 *   1. RELEVANCE   — its vector is close enough to the query (≥ a calibrated bar).
 *   2. ELIGIBILITY — it is actually servable: in stock and not policy-disapproved.
 *                    A perfectly relevant item that is out of stock or disapproved
 *                    never shows, so eligibility gates the verdict.
 *   3. (optional) FIX PATH — if it falls short, would applying the feed
 *                    recommendations push it over the bar?
 *
 * Verdicts: 'appears' | 'borderline' | 'absent' | 'ineligible'.
 *
 * This is a simulation of Google's matching, not Google. The relevance bar is a
 * threshold you can calibrate with the eval harness against labeled data; treat
 * the output as a directional probability, not a guarantee.
 */

import { cosineSimilarity, tokenize } from '../embeddings/embedder.js';
import { sigmoid } from '../ranking/ranker.js';
import { checkCompliance } from '../feed/compliance.js';

const APPEAR = 0.45;
const BORDERLINE = 0.3;

/**
 * Predict, for a single query, which products in the engine's catalog would
 * appear — with a verdict, probability, reasons, and (optionally) a fix path.
 *
 * @param {object} args
 * @param {import('../search/search-engine.js').SearchEngine} args.engine  catalog already indexed
 * @param {string} args.query
 * @param {number} [args.appearThreshold=0.45]
 * @param {number} [args.borderlineThreshold=0.30]
 * @param {Map<string,object>} [args.rawById]      raw feed items, to gate on disapproval
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} [args.taxonomy]
 * @param {Map<string,Float64Array>} [args.optimizedById]  optimized embeddings for the fix path
 * @returns {{ query, intentCategoryId, appearThreshold, borderlineThreshold, counts, rows }}
 */
export function predictAppearance({
  engine,
  query,
  appearThreshold = APPEAR,
  borderlineThreshold = BORDERLINE,
  rawById = new Map(),
  taxonomy = null,
  optimizedById = new Map(),
}) {
  const parsed = engine.parser.parse(query);
  const qVec = engine.embedder.embed(parsed.semanticText);
  const intentCategoryId = engine.classifier.bestCategoryId(query);
  const qTokens = [...new Set(tokenize(query))];

  const rows = engine.graph.all().map((p) => {
    const relevance = p.embedding ? cosineSimilarity(qVec, p.embedding) : 0;

    // Eligibility gating.
    const eligibilityIssues = [];
    if (!p.inStock) eligibilityIssues.push('out of stock');
    if (rawById.has(p.id) && taxonomy) {
      const c = checkCompliance({ raw: rawById.get(p.id), product: p, taxonomy });
      if (c.willLikelyDisapprove) eligibilityIssues.push('likely disapproved');
    }
    const eligible = eligibilityIssues.length === 0;

    const verdict = !eligible
      ? 'ineligible'
      : relevance >= appearThreshold
        ? 'appears'
        : relevance >= borderlineThreshold
          ? 'borderline'
          : 'absent';

    const probability = eligible ? round(sigmoid(12 * (relevance - appearThreshold))) : 0;

    // Which query terms the product copy does NOT represent (actionable gaps).
    const present = new Set(
      tokenize([p.title, p.description, Object.values(p.attributes ?? {}).join(' ')].join(' ')),
    );
    const missingTerms = qTokens.filter((t) => !present.has(t));

    // Fix path: would the optimized feed cross the bar?
    let afterFix = null;
    if (optimizedById.has(p.id)) {
      const ar = cosineSimilarity(qVec, optimizedById.get(p.id));
      afterFix = {
        relevance: round(ar),
        wouldAppear: eligible && ar >= appearThreshold,
        crossesBar: relevance < appearThreshold && ar >= appearThreshold,
      };
    }

    const categoryMatch = p.categoryId != null && p.categoryId === intentCategoryId;

    return {
      id: p.id,
      title: p.title,
      relevance: round(relevance),
      verdict,
      probability,
      eligible,
      eligibilityIssues,
      categoryMatch,
      missingTerms,
      afterFix,
      reasons: explain({ relevance, verdict, eligibilityIssues, categoryMatch, missingTerms, afterFix, appearThreshold, borderlineThreshold }),
    };
  });

  rows.sort((a, b) => b.relevance - a.relevance);
  let rank = 0;
  for (const r of rows) r.rank = r.verdict === 'appears' ? ++rank : null;

  const counts = { appears: 0, borderline: 0, absent: 0, ineligible: 0 };
  for (const r of rows) counts[r.verdict]++;

  return { query, parsed, intentCategoryId, appearThreshold, borderlineThreshold, counts, rows };
}

/** Convenience: the verdict for one specific product. */
export function predictForProduct(args, productId) {
  const out = predictAppearance(args);
  return out.rows.find((r) => r.id === productId) ?? null;
}

function explain({ relevance, verdict, eligibilityIssues, categoryMatch, missingTerms, afterFix, appearThreshold, borderlineThreshold }) {
  const reasons = [];
  if (verdict === 'ineligible') {
    reasons.push(`Ineligible to serve: ${eligibilityIssues.join(', ')} — won't appear regardless of relevance.`);
    return reasons;
  }
  if (verdict === 'appears') {
    reasons.push(`Strong relevance ${relevance} ≥ ${appearThreshold} bar.`);
    reasons.push(categoryMatch ? 'In the query\'s product category.' : 'Outside the inferred category, but semantically close.');
  } else if (verdict === 'borderline') {
    reasons.push(`Relevance ${relevance} sits between the ${borderlineThreshold} and ${appearThreshold} bars — page-2 territory.`);
    if (missingTerms.length) reasons.push(`Feed doesn't mention: ${missingTerms.join(', ')}.`);
  } else {
    reasons.push(`Relevance ${relevance} below the ${borderlineThreshold} bar — not a match today.`);
    if (missingTerms.length) reasons.push(`Product copy is missing the query's key terms: ${missingTerms.join(', ')}.`);
  }
  if (afterFix?.crossesBar) {
    reasons.push(`Applying the recommended feed fixes would lift relevance to ${afterFix.relevance} → it WOULD appear.`);
  }
  return reasons;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
