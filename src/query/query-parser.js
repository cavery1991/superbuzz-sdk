/**
 * Query factor extraction (the deconstruction Google performs on a search string).
 *
 * Given "waterproof black running shoes size 10" the parser isolates:
 *   - core entity / head noun .......... shoes      (-> a GPC category)
 *   - functional modifiers ............. waterproof (-> feature/material tech)
 *   - visual modifiers ................. black      (-> color variant)
 *   - usage modifiers .................. running    (-> activity / sub-category)
 *   - sizing & technical specs ......... size 10    (-> hard filter)
 *   - implied intent / synonyms ........ derived semantic concepts
 *
 * The structured result drives both hard filtering (specs, color) and the
 * semantic vector (implied concepts are folded into the query embedding).
 */

import { tokenize } from '../embeddings/embedder.js';
import { CONCEPTS } from '../embeddings/concepts.js';

const COLORS = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'gray', 'grey', 'brown', 'beige', 'navy', 'gold', 'silver', 'tan',
]);
const MATERIALS = new Set([
  'leather', 'cotton', 'wool', 'nylon', 'polyester', 'denim', 'suede', 'mesh',
  'ceramic', 'fleece', 'down', 'rubber', 'canvas',
]);
// Functional / feature modifiers -> the concept they imply.
const FUNCTIONAL = {
  waterproof: ['waterproof'], rainproof: ['waterproof'], insulated: ['warmth'],
  thermal: ['warmth'], wireless: ['wireless'], bluetooth: ['wireless'],
  nonstick: ['nonstick'], lightweight: ['lightweight'], durable: ['durable'],
  'noise-cancelling': ['noise_cancelling'], waterresistant: ['waterproof'],
};
// Usage / activity modifiers -> implied concept.
const USAGE = {
  running: ['running', 'athletic_shoe'], jogging: ['running'], gym: ['athletic_shoe'],
  hiking: ['camping'], camping: ['camping'], backpacking: ['camping'],
  workout: ['activewear'], training: ['activewear'], commuting: ['bag'],
  winter: ['cold_weather'],
};

// Phrase-level implied-intent rules. Each maps a regex over the raw query to the
// latent semantic concepts a human would infer (the "problem to solve").
const IMPLIED_INTENT = [
  { test: /won'?t slip|no[\s-]?slip|grip(?:s)?(?: on)? ice|slippery|traction/i, concepts: ['waterproof', 'cold_weather', 'durable'], tags: ['traction', 'rubber sole'] },
  { test: /keeps? (?:me|you)? ?dry|stay dry|in (?:a|the) (?:downpour|rain)|won'?t get wet/i, concepts: ['waterproof'], tags: ['rain protection'] },
  { test: /keeps? (?:me|you)? ?warm|for the cold|freezing|sub[\s-]?zero/i, concepts: ['warmth', 'cold_weather'], tags: [] },
  { test: /block(?:s)? (?:out )?noise|quiet|focus|on (?:a|the) (?:plane|flight)/i, concepts: ['noise_cancelling', 'wireless'], tags: [] },
  { test: /all day|long battery|lasts? long/i, concepts: [], tags: ['long battery life'] },
];

// Spec extractors: explicit measurements / model numbers / technical specs.
const SPEC_PATTERNS = [
  { key: 'size', re: /\bsize\s*([0-9]+(?:\.[0-9]+)?)\b/i },
  { key: 'size', re: /\b(?:us|eu|uk)\s*([0-9]+(?:\.[0-9]+)?)\b/i },
  { key: 'resolution', re: /\b(4k|8k|1080p|2k|uhd)\b/i },
  { key: 'version', re: /\b(v[0-9]+)\b/i },
  { key: 'capacity', re: /\b([0-9]+\s?(?:gb|tb|l|liter|litre|ml|oz))\b/i },
];

export class QueryParser {
  /**
   * @param {import('../search/classifier.js').CategoryClassifier} [classifier]
   *   optional; when provided the core entity is mapped to a GPC category.
   */
  constructor(classifier = null) {
    this.classifier = classifier;
    // term -> true for any token that names a concrete object (potential head noun)
    this._nounTerms = new Set();
    for (const [concept, terms] of Object.entries(CONCEPTS)) {
      if (['outerwear', 'shoe', 'athletic_shoe', 'top', 'bag', 'phone', 'laptop',
        'computer', 'headphones', 'cookware', 'sleeping_bag'].includes(concept)) {
        for (const t of terms) this._nounTerms.add(t);
      }
    }
  }

  /**
   * @param {string} query
   * @returns {{
   *   raw:string, coreEntity:string|null, categoryId:number|null,
   *   modifiers:{visual:string[], functional:string[], usage:string[], material:string[]},
   *   specs:Record<string,string>, attributes:Record<string,string>,
   *   impliedConcepts:string[], impliedTags:string[], semanticText:string
   * }}
   */
  parse(query) {
    const raw = String(query);
    const lower = raw.toLowerCase();
    const tokens = tokenize(raw);

    const visual = [];
    const material = [];
    const functional = [];
    const usage = [];
    const impliedConcepts = new Set();
    const attributes = {};

    for (const tok of tokens) {
      if (COLORS.has(tok)) {
        const c = tok === 'grey' ? 'gray' : tok;
        visual.push(c);
        attributes.color = c;
      }
      if (MATERIALS.has(tok)) {
        material.push(tok);
        attributes.material = tok;
      }
      if (FUNCTIONAL[tok]) {
        functional.push(tok);
        FUNCTIONAL[tok].forEach((c) => impliedConcepts.add(c));
      }
      if (USAGE[tok]) {
        usage.push(tok);
        USAGE[tok].forEach((c) => impliedConcepts.add(c));
      }
    }

    // Specs (operate on the raw string to catch "size 10", "4k", "v2").
    const specs = {};
    for (const { key, re } of SPEC_PATTERNS) {
      const m = lower.match(re);
      if (m && specs[key] === undefined) specs[key] = m[1].replace(/\s+/g, '');
    }
    if (specs.size) attributes.size = specs.size;

    // Implied intent (phrase level).
    const impliedTags = [];
    for (const rule of IMPLIED_INTENT) {
      if (rule.test.test(raw)) {
        rule.concepts.forEach((c) => impliedConcepts.add(c));
        impliedTags.push(...rule.tags);
      }
    }

    // Core entity: the head noun — last token that names a concrete object,
    // else the last content token.
    let coreEntity = null;
    for (const tok of tokens) if (this._nounTerms.has(tok)) coreEntity = tok;
    if (!coreEntity && tokens.length) coreEntity = tokens[tokens.length - 1];

    const categoryId = this.classifier ? this.classifier.bestCategoryId(raw) : null;

    // Semantic text fed to the embedder: the raw query plus a representative
    // term per implied concept so latent intent shifts the query vector.
    const conceptTerms = [...impliedConcepts]
      .map((c) => (CONCEPTS[c] ? CONCEPTS[c][0] : null))
      .filter(Boolean);
    const semanticText = [raw, ...conceptTerms, ...impliedTags].join(' ');

    return {
      raw,
      coreEntity,
      categoryId,
      modifiers: { visual, functional, usage, material },
      specs,
      attributes,
      impliedConcepts: [...impliedConcepts],
      impliedTags,
      semanticText,
    };
  }
}
