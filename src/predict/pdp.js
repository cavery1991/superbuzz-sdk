/**
 * PDP scanning — point it at a product detail page (URL or HTML), and it:
 *   1. extracts the product (schema.org JSON-LD → OpenGraph → <title>/meta),
 *   2. infers the searches that product would *want* to appear for, and
 *   3. scores the likelihood of it appearing for each.
 *
 * This is the single-product mirror of the feed pipeline: instead of "given a
 * query, which products appear?", it answers "given a product, which queries
 * could it win, and how likely?". Likelihood here is the product's own match
 * strength (relevance vs a calibrated bar), gated by eligibility — not a
 * competitive rank, since a lone PDP has no competitors to rank against.
 */

import { cosineSimilarity, tokenize } from '../embeddings/embedder.js';
import { sigmoid } from '../ranking/ranker.js';
import { CONCEPTS } from '../embeddings/concepts.js';

/**
 * Extract a normalized product from a product-detail-page's HTML.
 * @param {string} html
 * @param {object} [opts] @param {string} [opts.url]
 * @returns {{ id, title, description, brand, price, currency, categoryId, attributes, inStock, link }}
 */
export function extractProductFromHtml(html, { url } = {}) {
  const out = { attributes: {}, link: url ?? null };
  const ld = findJsonLdProduct(html);
  if (ld) {
    if (ld.name) out.title = clean(ld.name);
    if (ld.description) out.description = clean(ld.description);
    if (ld.brand) out.brand = clean(typeof ld.brand === 'string' ? ld.brand : ld.brand.name);
    if (ld.color) out.attributes.color = String(ld.color).toLowerCase();
    if (ld.material) out.attributes.material = String(ld.material).toLowerCase();
    if (ld.size) out.attributes.size = String(ld.size);
    if (ld.sku || ld.productID) out.id = String(ld.sku ?? ld.productID);
    const offer = ld.offers ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) : null;
    if (offer) {
      if (offer.price != null) out.price = Number(offer.price);
      if (offer.priceCurrency) out.currency = offer.priceCurrency;
      if (offer.availability) out.inStock = /InStock|LimitedAvailability|PreOrder/i.test(String(offer.availability));
    }
  }

  // Fallbacks from OpenGraph / <title> / meta description.
  out.title = out.title || meta(html, 'og:title') || titleTag(html);
  out.description = out.description || meta(html, 'og:description') || metaName(html, 'description') || '';
  if (out.price == null) {
    const og = meta(html, 'product:price:amount') || meta(html, 'og:price:amount');
    if (og) out.price = Number(og);
  }
  if (out.inStock == null) out.inStock = true;
  out.id = out.id || slug(out.title) || 'pdp-1';
  out.title = out.title || '';
  out.currency = out.currency || 'USD';
  return out;
}

const NOUN_CONCEPTS = ['outerwear', 'shoe', 'athletic_shoe', 'top', 'bag', 'phone', 'laptop', 'computer', 'headphones', 'cookware', 'sleeping_bag'];
const MODIFIER_CONCEPTS = ['warmth', 'cold_weather', 'waterproof', 'wireless', 'noise_cancelling', 'lightweight', 'durable', 'running', 'camping', 'nonstick', 'premium'];

/**
 * Infer the searches a product would want to appear for, from its own data.
 * @param {object} product  normalized product (title, brand, attributes, categoryId, description)
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} taxonomy
 * @param {object} [opts] @param {number} [opts.limit=20]
 * @returns {string[]}
 */
export function inferSearchQueries(product, taxonomy, { limit = 20 } = {}) {
  const tokens = new Set([
    ...tokenize(product.title ?? ''),
    ...tokenize(product.description ?? ''),
  ]);
  const noun = headNoun(product, taxonomy, tokens);
  const color = product.attributes?.color;
  const material = product.attributes?.material;
  const brand = product.brand ? product.brand.toLowerCase() : null;

  // Concepts the product's own text evidences → modifiers it can credibly target.
  const evidenced = conceptsPresent(tokens);

  const q = new Set();
  if (noun) {
    q.add(noun);
    if (color) q.add(`${color} ${noun}`);
    if (material) q.add(`${material} ${noun}`);
    if (brand) q.add(`${brand} ${noun}`);
    for (const c of evidenced.modifiers) {
      const term = CONCEPTS[c]?.[0];
      if (term) {
        q.add(`${term} ${noun}`);
        if (color) q.add(`${term} ${color} ${noun}`);
      }
    }
    if (color && brand) q.add(`${color} ${brand} ${noun}`);
  }
  // Always include the full title as the most specific query.
  if (product.title) q.add(product.title.toLowerCase());

  return [...q].filter(Boolean).slice(0, limit);
}

/**
 * Scan a product: infer target queries and score appearance likelihood for each.
 * The product must already be indexed in `engine` (so it has an embedding).
 * @param {object} args
 * @param {import('../search/search-engine.js').SearchEngine} args.engine
 * @param {object} args.product  the (indexed) product to scan
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @param {string[]} [args.queries]  override the inferred query set
 * @param {number} [args.appearThreshold=0.45]
 * @returns {{ product, eligible, eligibilityIssues, queries: object[] }}
 */
export function scanProduct({ engine, product, taxonomy, queries, appearThreshold = 0.45 }) {
  const stored = engine.graph.get(product.id) ?? product;
  const targets = queries ?? inferSearchQueries(stored, taxonomy);

  const eligibilityIssues = [];
  if (!stored.inStock) eligibilityIssues.push('out of stock');
  const eligible = eligibilityIssues.length === 0;

  const scored = targets.map((query) => {
    const qVec = engine.embedder.embed(engine.parser.parse(query).semanticText);
    const relevance = stored.embedding ? cosineSimilarity(qVec, stored.embedding) : 0;
    const likelihood = eligible ? round(sigmoid(12 * (relevance - appearThreshold))) : 0;
    const verdict = !eligible
      ? 'ineligible'
      : relevance >= appearThreshold ? 'likely'
        : relevance >= appearThreshold - 0.15 ? 'possible' : 'unlikely';
    return { query, relevance: round(relevance), likelihood, verdict };
  });
  scored.sort((a, b) => b.relevance - a.relevance);

  return { product: stored, eligible, eligibilityIssues, appearThreshold, queries: scored };
}

// ---- HTML/JSON-LD helpers -------------------------------------------------

function findJsonLdProduct(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const found = pickProduct(data);
    if (found) return found;
  }
  return null;
}

function pickProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const p = pickProduct(n); if (p) return p; }
    return null;
  }
  const type = node['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct) return node;
  if (Array.isArray(node['@graph'])) return pickProduct(node['@graph']);
  return null;
}

function meta(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${escapeRe(prop)}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escapeRe(prop)}["']`, 'i'));
  return m ? clean(m[1]) : null;
}
function metaName(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${escapeRe(name)}["'][^>]+content=["']([^"']*)["']`, 'i'));
  return m ? clean(m[1]) : null;
}
function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(m[1]) : null;
}

function headNoun(product, taxonomy, tokens) {
  // Prefer a concrete noun from the product's own title (e.g. "parka") — it reads
  // far more naturally than a compound category leaf ("coats & jackets").
  for (const tok of tokens) {
    for (const c of NOUN_CONCEPTS) if (CONCEPTS[c]?.includes(tok)) return tok;
  }
  // Else the category leaf, reduced to its last word and singularized.
  if (product.categoryId != null && taxonomy) {
    const node = taxonomy.get(product.categoryId);
    if (node) {
      const last = node.name.toLowerCase().split(/[^a-z]+/).filter(Boolean).pop();
      if (last) return last.replace(/s$/, '');
    }
  }
  const words = tokenize(product.title ?? '');
  return words[words.length - 1] ?? '';
}

function conceptsPresent(tokens) {
  const modifiers = new Set();
  for (const [concept, terms] of Object.entries(CONCEPTS)) {
    if (!MODIFIER_CONCEPTS.includes(concept)) continue;
    if (terms.some((t) => tokens.has(t))) modifiers.add(concept);
  }
  return { modifiers: [...modifiers] };
}

function clean(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function slug(s) {
  return s ? String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) : '';
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function round(n) {
  return Math.round(n * 1000) / 1000;
}
