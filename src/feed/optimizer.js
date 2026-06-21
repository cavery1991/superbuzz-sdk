/**
 * Optimizer — turns audit issues into concrete, ranked recommendations and
 * builds the *optimized* version of a product used to simulate impact.
 *
 * The optimized representation is what the feed would look like after applying
 * the recommendations: a richer title, the corrected GPC, attributes folded in,
 * and review/vision signals surfaced. Re-embedding it lets the analyzer measure
 * the relevance lift a merchant would get from acting on the advice.
 */

import { CONCEPTS } from '../embeddings/concepts.js';

/**
 * @param {object} args
 * @param {object} args.raw
 * @param {object} args.product       normalized product
 * @param {object} args.audit         output of auditProduct
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @param {string[]} [args.derivedTags]
 * @param {string[]} [args.derivedConcepts]
 * @returns {{
 *   recommendations: Array<{type:string, priority:string, message:string}>,
 *   suggestedTitle: string,
 *   suggestedCategoryId: number|null,
 *   optimizedText: string
 * }}
 */
export function optimizeProduct({ raw, product, audit, taxonomy, derivedTags = [], derivedConcepts = [] }) {
  const recommendations = [];
  const attrs = product.attributes ?? {};

  // Resolve the suggested category (fix mismatch / fill missing).
  let suggestedCategoryId = product.categoryId;
  const gpcIssue = audit.issues.find((i) => i.type === 'gpc_mismatch' || i.type === 'gpc_missing');
  if (gpcIssue) {
    const target = gpcIssue.predicted ?? product.categoryId;
    if (target != null) {
      suggestedCategoryId = target;
      const node = taxonomy.get(target);
      recommendations.push(rec('set_gpc', 'high',
        `Set google_product_category to [${target}] ${node ? node.path : ''}.`));
    }
  }

  // Recommend filling missing attributes (high-value, used for matching).
  for (const i of audit.issues) {
    if (i.type === 'missing_required' || i.type === 'missing_recommended') {
      const priority = i.severity === 'high' ? 'high' : 'medium';
      recommendations.push(rec('add_attribute', priority, `Add ${i.field} to the feed.`));
    }
  }

  // Title enrichment recommendation (additive — never drops existing content).
  const suggestedTitle = buildTitle(raw, product);
  if (suggestedTitle && norm(suggestedTitle) !== norm(raw.title)) {
    recommendations.push(rec('rewrite_title', 'high', `Enrich title to: "${suggestedTitle}"`));
  }

  // Surface footprint signals in the description.
  const footprint = audit.issues.find((i) => i.type === 'footprint_unsurfaced');
  if (footprint && footprint.tags?.length) {
    recommendations.push(rec('surface_signals', 'medium',
      `Mention review/image themes in the description: ${footprint.tags.slice(0, 4).join(', ')}.`));
  }

  // Build the optimized text representation for impact simulation. It is a strict
  // superset of the current product text (enriched title + every attribute +
  // corrected category + surfaced review/image signals), so the simulated lift
  // reflects information *added*, never content removed.
  const categoryPath = suggestedCategoryId != null ? (taxonomy.get(suggestedCategoryId)?.parts.join(' ') ?? '') : '';
  const conceptTerms = derivedConcepts.map((c) => (CONCEPTS[c] ? CONCEPTS[c][0] : '')).filter(Boolean);
  const optimizedText = [
    raw.title,
    suggestedTitle,
    raw.description,
    Object.values(attrs).join(' '),
    categoryPath,
    derivedTags.join(' '),
    ...conceptTerms,
  ].filter(Boolean).join(' ');

  // Sort recommendations by priority.
  const order = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => order[a.priority] - order[b.priority]);

  return { recommendations, suggestedTitle, suggestedCategoryId, optimizedText };
}

/**
 * Enrich the existing title rather than rebuild it: prepend the brand if absent
 * and append any searchable attributes (color/material/size) the title omits.
 * This preserves the merchant's good content and only adds what's missing.
 */
function buildTitle(raw, product) {
  const attrs = product.attributes ?? {};
  let title = String(raw.title ?? '').trim();
  const lower = () => title.toLowerCase();

  if (raw.brand && !lower().includes(String(raw.brand).toLowerCase())) {
    title = `${cap(raw.brand)} ${title}`.trim();
  }
  const additions = [];
  for (const a of ['color', 'material']) {
    if (attrs[a] && !lower().includes(attrs[a])) additions.push(cap(attrs[a]));
  }
  if (additions.length) title = `${title} ${additions.join(' ')}`.trim();
  if (attrs.size && !lower().includes(`size ${attrs.size}`) && !new RegExp(`\\b${attrs.size}\\b`).test(lower())) {
    title = `${title} - Size ${String(attrs.size).toUpperCase()}`;
  }
  return title.trim();
}

function cap(s) {
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function rec(type, priority, message) {
  return { type, priority, message };
}
