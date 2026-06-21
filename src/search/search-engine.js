/**
 * Semantic search engine — the operation that ties every pillar together.
 *
 *   1. GPC taxonomy    : the number system / digital aisles
 *   2. embeddings       : semantic vector matching via cosine similarity
 *   3. Shopping Graph   : the product store with structured attributes & inventory
 *   4. query parser     : deconstructs the search string into logical factors
 *   5. product profiles : fuse feed + schema + vision + reviews into one vector
 *   6. context re-rank   : geo / device / co-purchase real-time weighting
 *
 * Indexing a product:
 *   - optionally build a fused semantic profile (schema JSON-LD, vision tags,
 *     review mining) so the vector reflects the whole digital footprint
 *   - classify it into a GPC category (if not already tagged)
 *   - embed the enriched representation and store the vector on the graph node
 *
 * Searching a query:
 *   - parse the query into core entity, modifiers, specs, implied intent
 *   - infer the GPC aisle and lift structured filters (specs, color, brand)
 *   - embed the intent-expanded query and rank candidates by a blended score:
 *       semantic similarity + category alignment + attribute match + quality + stock
 *   - re-rank by real-time context (geo / device / co-purchasing) when provided
 */

import { cosineSimilarity } from '../embeddings/embedder.js';
import { CategoryClassifier } from './classifier.js';
import { QueryParser } from '../query/query-parser.js';
import { buildProductProfile } from '../product/profile.js';
import { applyContext } from '../ranking/context.js';
import { CONCEPTS } from '../embeddings/concepts.js';

const DEFAULT_WEIGHTS = {
  semantic: 1.0, // cosine similarity between query and product
  category: 0.25, // bonus when product sits in (or under) the query's category
  quality: 0.1, // review rating signal
  stock: 0.3, // penalty applied to out-of-stock items (favor in-stock options)
};

export class SearchEngine {
  /**
   * @param {object} deps
   * @param {import('../taxonomy/taxonomy.js').Taxonomy} deps.taxonomy
   * @param {import('../embeddings/embedder.js').Embedder} deps.embedder
   * @param {import('../graph/shopping-graph.js').ShoppingGraph} deps.graph
   * @param {object} [deps.weights]
   */
  constructor({ taxonomy, embedder, graph, weights = {} }) {
    this.taxonomy = taxonomy;
    this.embedder = embedder;
    this.graph = graph;
    this.classifier = new CategoryClassifier(taxonomy, embedder);
    this.parser = new QueryParser(this.classifier);
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Index one product into the Shopping Graph: profile + classify + embed + store.
   * A product may carry extra factor sources that are fused into its profile:
   *   - `schema`      schema.org Product JSON-LD
   *   - `visionTags`  computer-vision image tags
   *   - `reviews`     review/Q&A text (mined for semantic tags)
   * @param {import('../graph/shopping-graph.js').Product} product
   */
  index(product) {
    let base = product;
    let enriched = null;
    let derivedConcepts = [];

    if (product.schema || product.visionTags || product.reviews) {
      const profile = buildProductProfile({
        feed: stripProfileInputs(product),
        schema: product.schema,
        visionTags: product.visionTags,
        reviews: product.reviews,
      });
      base = profile.product;
      enriched = profile.enrichedText;
      derivedConcepts = profile.derivedConcepts;
    }

    const categoryId =
      base.categoryId ?? this.classifier.bestCategoryId(productText(base, this.taxonomy));
    const stored = this.graph.upsert({ ...base, categoryId });

    const text = [
      enriched ?? productText(stored, this.taxonomy),
      categoryPathText(stored, this.taxonomy),
      ...derivedConcepts.map(conceptTerm),
    ]
      .filter(Boolean)
      .join(' ');
    stored.embedding = this.embedder.embed(text);
    return stored;
  }

  indexAll(products) {
    return products.map((p) => this.index(p));
  }

  /**
   * Semantic product search.
   * @param {string} query
   * @param {object} [opts]
   * @param {number} [opts.limit=10]
   * @param {boolean} [opts.inStockOnly=false]
   * @param {Record<string,string>} [opts.attributes] hard structured filters
   * @param {string} [opts.brand]
   * @param {number} [opts.maxPrice]
   * @param {number} [opts.minRating]
   * @param {boolean} [opts.useCategory=true] bias toward the query's inferred aisle
   * @param {boolean} [opts.useSpecsAsFilters=true] treat detected size/specs as hard filters
   * @param {object} [opts.context] real-time context (region, device, query, coPurchase)
   * @returns {{query:string, parsed:object, intent:object, results:object[]}}
   */
  search(query, opts = {}) {
    const {
      limit = 10,
      inStockOnly = false,
      attributes,
      brand,
      maxPrice,
      minRating,
      useCategory = true,
      useSpecsAsFilters = true,
      context,
    } = opts;

    const parsed = this.parser.parse(query);
    // The intent-expanded text shifts the query vector toward implied concepts.
    const queryVec = this.embedder.embed(parsed.semanticText);

    const intentCategories = this.classifier.classify(query, 3);
    const intentCategoryId = useCategory && intentCategories[0]?.score > 0 ? intentCategories[0].id : null;
    const intentLineage = intentCategoryId != null
      ? new Set(this.taxonomy.ancestors(intentCategoryId).map((n) => n.id).concat(descendantIds(this.taxonomy, intentCategoryId)))
      : null;

    // Hard structured filters: explicit opts win; detected specs (size) narrow too.
    const hardAttrs = { ...attributes };
    if (useSpecsAsFilters && parsed.specs.size) hardAttrs.size = parsed.specs.size;
    const candidates = this.graph.filter({
      brand,
      inStock: inStockOnly,
      maxPrice,
      minRating,
      attributes: Object.keys(hardAttrs).length ? hardAttrs : undefined,
    });

    // Soft attribute boosts (color/material detected in the query).
    const softAttrs = parsed.attributes;

    const w = this.weights;
    const scored = [];
    for (const p of candidates) {
      if (!p.embedding) continue;
      const semantic = cosineSimilarity(queryVec, p.embedding);

      let categoryBonus = 0;
      if (intentLineage && p.categoryId != null && intentLineage.has(p.categoryId)) {
        categoryBonus = p.categoryId === intentCategoryId ? 1 : 0.5;
      }

      let attrBonus = 0;
      for (const [k, v] of Object.entries(softAttrs)) {
        if (k === 'size') continue; // handled as hard filter
        if (p.attributes[k.toLowerCase()] === String(v).toLowerCase()) attrBonus += 0.5;
      }

      const quality = (p.rating ?? 0) / 5;
      const stock = p.inStock ? 0 : -1; // out-of-stock penalty

      const score =
        w.semantic * semantic +
        w.category * categoryBonus +
        w.semantic * 0.2 * attrBonus +
        w.quality * quality +
        w.stock * stock;

      scored.push({
        product: p,
        score,
        breakdown: { semantic, categoryBonus, attrBonus, quality, stock },
      });
    }

    scored.sort((a, b) => b.score - a.score);

    let results = scored;
    if (context) {
      results = applyContext(scored, { query, ...context });
    }

    return {
      query,
      parsed,
      intent: {
        categories: intentCategories,
        topCategory: intentCategoryId != null ? this.taxonomy.get(intentCategoryId) : null,
        coreEntity: parsed.coreEntity,
        detectedAttributes: parsed.attributes,
        impliedConcepts: parsed.impliedConcepts,
        specs: parsed.specs,
      },
      results: results.slice(0, limit),
    };
  }
}

/** Build the plain text that represents a product for embedding/classification. */
function productText(product, taxonomy) {
  const parts = [product.title, product.brand, product.description];
  if (product.attributes) parts.push(Object.values(product.attributes).join(' '));
  parts.push(categoryPathText(product, taxonomy));
  return parts.filter(Boolean).join(' ');
}

function categoryPathText(product, taxonomy) {
  if (product.categoryId != null && taxonomy) {
    const node = taxonomy.get(product.categoryId);
    if (node) return node.parts.join(' ');
  }
  return '';
}

/** A representative surface term for a concept id (first synonym). */
function conceptTerm(conceptId) {
  return CONCEPTS[conceptId] ? CONCEPTS[conceptId][0] : '';
}

/** Remove profile-only inputs so they aren't stored as product fields. */
function stripProfileInputs(product) {
  const { schema, visionTags, reviews, ...rest } = product;
  return rest;
}

function descendantIds(taxonomy, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const child of taxonomy.children(cur)) {
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}
