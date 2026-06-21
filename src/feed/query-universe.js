/**
 * Query universe — the set of searches the catalog is evaluated against.
 *
 * Two sources, designed to merge:
 *   - REAL: rows from an ingested Search Terms report (actual queries that
 *     triggered the merchant's products, with impression/click/conversion value).
 *   - GENERATED: synthetic but realistic queries derived from each category
 *     present in the feed, combined with the attribute values (color, material,
 *     brand) and modifiers (usage/functional concepts) that appear in the catalog.
 *
 * When real data is present it dominates; generated queries fill the gaps so the
 * tool still works with zero Google account access.
 */

import { CONCEPTS } from '../embeddings/concepts.js';

// Concepts that read naturally as query modifiers, grouped by relevance so we
// don't, e.g., pair "waterproof" with a frying pan.
const MODIFIER_CONCEPTS = ['warmth', 'cold_weather', 'waterproof', 'wireless',
  'noise_cancelling', 'lightweight', 'durable', 'running', 'camping', 'nonstick',
  'premium', 'budget'];

/**
 * @param {object} args
 * @param {object[]} args.products    normalized products (with categoryId, attributes, brand)
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @param {Array<{query:string,value:number}>} [args.searchTerms] real report rows
 * @param {number} [args.perCategory=12] cap on generated queries per category
 * @returns {Array<{query:string, value:number, source:'real'|'generated', categoryId:number|null}>}
 */
export function buildQueryUniverse({ products, taxonomy, searchTerms = [], perCategory = 12 }) {
  const seen = new Map(); // normalized query -> entry

  // 1. Real search terms (highest signal).
  for (const t of searchTerms) {
    const key = norm(t.query);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, { query: t.query, value: t.value ?? 1, source: 'real', categoryId: null });
    } else {
      seen.get(key).value += t.value ?? 1;
    }
  }

  // 2. Generated queries per category present in the catalog.
  const byCategory = groupByCategory(products);
  for (const [categoryId, items] of byCategory) {
    const node = taxonomy.get(Number(categoryId));
    if (!node) continue;
    const noun = leafNoun(node);
    const colors = topValues(items, 'color', 3);
    const materials = topValues(items, 'material', 2);
    const brands = uniq(items.map((p) => p.brand).filter(Boolean)).slice(0, 2);
    const modifiers = relevantModifiers(node);

    const generated = new Set();
    generated.add(noun);
    for (const c of colors) generated.add(`${c} ${noun}`);
    for (const b of brands) generated.add(`${b.toLowerCase()} ${noun}`);
    for (const m of modifiers) generated.add(`${m} ${noun}`);
    for (const c of colors) for (const b of brands) generated.add(`${c} ${b.toLowerCase()} ${noun}`);
    for (const m of modifiers) for (const c of colors) generated.add(`${m} ${c} ${noun}`);
    for (const mat of materials) generated.add(`${mat} ${noun}`);

    let count = 0;
    for (const q of generated) {
      if (count >= perCategory) break;
      const key = norm(q);
      if (!key || seen.has(key)) continue;
      seen.set(key, { query: q, value: 1, source: 'generated', categoryId: Number(categoryId) });
      count++;
    }
  }

  return [...seen.values()];
}

function groupByCategory(products) {
  const map = new Map();
  for (const p of products) {
    if (p.categoryId == null) continue;
    if (!map.has(p.categoryId)) map.set(p.categoryId, []);
    map.get(p.categoryId).push(p);
  }
  return map;
}

function leafNoun(node) {
  // Use the leaf category name, lowercased and lightly singularized.
  const name = node.name.toLowerCase();
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

/** Modifier concepts whose terms semantically relate to the category path. */
function relevantModifiers(node) {
  const path = node.parts.join(' ').toLowerCase();
  const out = [];
  for (const c of MODIFIER_CONCEPTS) {
    const terms = CONCEPTS[c] ?? [];
    // Keep a modifier if its concept plausibly belongs to this branch.
    if (CATEGORY_MODIFIERS.some(([re, concepts]) => re.test(path) && concepts.includes(c))) {
      out.push(terms[0]);
    }
  }
  return out.slice(0, 3);
}

// Which modifier concepts make sense for which category branches.
const CATEGORY_MODIFIERS = [
  [/outerwear|coats|jackets|clothing/, ['warmth', 'cold_weather', 'waterproof', 'lightweight']],
  [/shoes|footwear/, ['running', 'waterproof', 'lightweight', 'durable']],
  [/audio|headphones|electronics/, ['wireless', 'noise_cancelling', 'premium']],
  [/camping|outdoor|hiking/, ['lightweight', 'durable', 'waterproof', 'camping']],
  [/cookware|kitchen/, ['nonstick', 'durable', 'premium']],
  [/handbags|backpacks|cases/, ['lightweight', 'durable']],
];

function topValues(items, attr, n) {
  const counts = new Map();
  for (const p of items) {
    const v = p.attributes?.[attr];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
}

function uniq(arr) {
  return [...new Set(arr)];
}

function norm(q) {
  return String(q).toLowerCase().replace(/\s+/g, ' ').trim();
}
