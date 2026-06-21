/**
 * The Shopping Graph.
 *
 * Google's Shopping Graph is a vast, continuously-updated database of product
 * listings. It goes beyond keywords to understand structured attributes — size,
 * color, material, brand, variants — and tracks inventory and reviews so users
 * are shown relevant, in-stock options.
 *
 * This is an in-memory implementation of that store. It holds normalized product
 * nodes, indexes them by id / brand / category / attribute, and exposes the
 * filtering primitives the search engine builds on. Storage is pluggable: the
 * public shape (add/get/all/filter) is all the search layer depends on, so this
 * can be backed by D1, Postgres, Vectorize, etc. without touching callers.
 */

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [brand]
 * @property {number} [price]
 * @property {string} [currency]
 * @property {number|null} [categoryId]      resolved GPC category id
 * @property {Record<string,string>} [attributes]  color/size/material/etc.
 * @property {boolean} [inStock]
 * @property {number} [inventory]            units available
 * @property {number} [rating]               avg review score (0-5)
 * @property {number} [reviewCount]
 * @property {Float64Array} [embedding]      filled in by the search engine
 */

export class ShoppingGraph {
  constructor() {
    /** @type {Map<string, Product>} */
    this.products = new Map();
    /** @type {Map<string, Set<string>>} brand(lower) -> ids */
    this._byBrand = new Map();
    /** @type {Map<number, Set<string>>} categoryId -> ids */
    this._byCategory = new Map();
    /** @type {Map<string, Set<string>>} "attr=value"(lower) -> ids */
    this._byAttribute = new Map();
  }

  /** Insert or replace a product, keeping indexes in sync. */
  upsert(product) {
    if (!product || !product.id) throw new Error('product.id is required');
    if (this.products.has(product.id)) this._deindex(this.products.get(product.id));

    const normalized = normalizeProduct(product);
    this.products.set(normalized.id, normalized);
    this._index(normalized);
    return normalized;
  }

  /** Bulk insert. */
  upsertAll(products) {
    return products.map((p) => this.upsert(p));
  }

  get(id) {
    return this.products.get(id) ?? null;
  }

  /** @returns {Product[]} */
  all() {
    return [...this.products.values()];
  }

  get size() {
    return this.products.size;
  }

  /**
   * Filter products by structured constraints — the attribute understanding the
   * Shopping Graph is known for.
   * @param {object} [f]
   * @param {string} [f.brand]
   * @param {number|number[]} [f.categoryId]
   * @param {boolean} [f.inStock]   if true, only in-stock items
   * @param {number} [f.maxPrice]
   * @param {number} [f.minPrice]
   * @param {number} [f.minRating]
   * @param {Record<string,string>} [f.attributes]  e.g. { color: 'blue' }
   * @returns {Product[]}
   */
  filter(f = {}) {
    let candidates = null; // null means "all"

    if (f.brand) {
      candidates = intersect(candidates, this._byBrand.get(f.brand.toLowerCase()));
    }
    if (f.categoryId != null) {
      const ids = Array.isArray(f.categoryId) ? f.categoryId : [f.categoryId];
      let union = new Set();
      for (const cid of ids) {
        for (const pid of this._byCategory.get(cid) ?? []) union.add(pid);
      }
      candidates = intersect(candidates, union);
    }
    if (f.attributes) {
      for (const [k, v] of Object.entries(f.attributes)) {
        candidates = intersect(candidates, this._byAttribute.get(attrKey(k, v)));
      }
    }

    let result = candidates
      ? [...candidates].map((id) => this.products.get(id))
      : this.all();

    if (f.inStock) result = result.filter((p) => p.inStock);
    if (f.maxPrice != null) result = result.filter((p) => p.price != null && p.price <= f.maxPrice);
    if (f.minPrice != null) result = result.filter((p) => p.price != null && p.price >= f.minPrice);
    if (f.minRating != null) result = result.filter((p) => (p.rating ?? 0) >= f.minRating);

    return result;
  }

  /** Aggregate stats about the catalog. */
  stats() {
    const all = this.all();
    const brands = new Set();
    const categories = new Set();
    let inStock = 0;
    for (const p of all) {
      if (p.brand) brands.add(p.brand);
      if (p.categoryId != null) categories.add(p.categoryId);
      if (p.inStock) inStock++;
    }
    return {
      products: all.length,
      brands: brands.size,
      categories: categories.size,
      inStock,
    };
  }

  _index(p) {
    if (p.brand) addTo(this._byBrand, p.brand.toLowerCase(), p.id);
    if (p.categoryId != null) addTo(this._byCategory, p.categoryId, p.id);
    for (const [k, v] of Object.entries(p.attributes)) addTo(this._byAttribute, attrKey(k, v), p.id);
  }

  _deindex(p) {
    if (p.brand) removeFrom(this._byBrand, p.brand.toLowerCase(), p.id);
    if (p.categoryId != null) removeFrom(this._byCategory, p.categoryId, p.id);
    for (const [k, v] of Object.entries(p.attributes)) removeFrom(this._byAttribute, attrKey(k, v), p.id);
  }
}

function normalizeProduct(p) {
  const inventory = p.inventory ?? null;
  return {
    id: String(p.id),
    title: p.title ?? '',
    description: p.description ?? '',
    brand: p.brand ?? null,
    price: p.price ?? null,
    currency: p.currency ?? 'USD',
    categoryId: p.categoryId ?? null,
    attributes: lowerKeys(p.attributes ?? {}),
    inStock: p.inStock ?? (inventory != null ? inventory > 0 : true),
    inventory,
    rating: p.rating ?? null,
    reviewCount: p.reviewCount ?? 0,
    embedding: p.embedding ?? null,
    // Real-time context signals consumed by the contextual re-ranker.
    localInventory: p.localInventory ?? null,
    pickupToday: p.pickupToday ?? false,
  };
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = String(v);
  return out;
}

function attrKey(k, v) {
  return `${String(k).toLowerCase()}=${String(v).toLowerCase()}`;
}

function addTo(map, key, id) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}

function removeFrom(map, key, id) {
  const set = map.get(key);
  if (set) {
    set.delete(id);
    if (set.size === 0) map.delete(key);
  }
}

function intersect(a, b) {
  const bSet = b ?? new Set();
  if (a == null) return new Set(bSet);
  const out = new Set();
  for (const x of a) if (bSet.has(x)) out.add(x);
  return out;
}
