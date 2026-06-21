/**
 * Vector embeddings + semantic similarity.
 *
 * Google maps both the user's query and your product data into a high-dimensional
 * space where concepts with similar meaning sit close together. A search for
 * "warm winter coat" lands near "insulated outerwear", "thermal parka" and
 * "cold weather jacket" even when none of those exact words appear in the listing.
 *
 * This file provides:
 *   - `Embedder`        : the provider interface (swap in Vertex/OpenAI/etc.)
 *   - `LocalEmbedder`   : a self-contained, deterministic, offline embedder
 *   - `cosineSimilarity`: similarity between two vectors
 *
 * The LocalEmbedder is not a neural model — instead it uses feature hashing over
 * word n-grams *plus* a curated concept/synonym layer. The concept layer is the
 * key to semantic matching: related terms (coat/jacket/parka/outerwear) collapse
 * onto a shared "concept" dimension, so paraphrases end up near each other.
 */

import { CONCEPTS } from './concepts.js';

/**
 * Provider interface.
 *
 * Synchronous core: `dim` + `embed(text) -> Float64Array`. The engine builds and
 * queries synchronously, so `embed` must return immediately.
 *
 * Async providers (real API models) cannot fetch synchronously, so they also
 * implement `warm(texts)` — pre-fetch and cache vectors — after which `embed`
 * serves them from cache. Local providers inherit no-op defaults. The default
 * `embedBatch` simply maps `embed`, which real providers override to batch.
 *
 * @interface
 */
export class Embedder {
  get dim() {
    throw new Error('not implemented');
  }
  /** @param {string} _text @returns {Float64Array} */
  embed(_text) {
    throw new Error('not implemented');
  }
  /** Pre-fetch and cache vectors for `texts`. No-op for synchronous providers. */
  async warm(_texts) {
    /* no-op */
  }
  /** @param {string[]} texts @returns {Promise<Float64Array[]>} */
  async embedBatch(texts) {
    await this.warm(texts);
    return texts.map((t) => this.embed(t));
  }
}

const WORD_WEIGHT = 1.0;
const BIGRAM_WEIGHT = 0.6;
const CONCEPT_WEIGHT = 2.2; // concept hits dominate so synonyms align strongly

export class LocalEmbedder extends Embedder {
  /**
   * The vector is split into two regions:
   *   - a reserved, collision-free block (one dimension per concept) that holds
   *     the semantic signal — synonyms always land on the exact same dimension;
   *   - a feature-hashed block for raw words and bigrams (lexical signal).
   *
   * @param {object} [opts]
   * @param {number} [opts.hashDim=512] size of the hashed (lexical) block
   * @param {Record<string,string[]>} [opts.concepts] term -> concept groups
   */
  constructor({ hashDim = 512, concepts = CONCEPTS } = {}) {
    super();
    // Stable concept -> reserved index map.
    this._conceptIndex = new Map();
    for (const conceptId of Object.keys(concepts).sort()) {
      this._conceptIndex.set(conceptId, this._conceptIndex.size);
    }
    this._conceptCount = this._conceptIndex.size;
    this._hashDim = hashDim;
    this._dim = this._conceptCount + hashDim;

    // Reverse index: term -> [conceptId, ...]
    this._termToConcepts = new Map();
    for (const [conceptId, terms] of Object.entries(concepts)) {
      for (const term of terms) {
        const key = term.toLowerCase();
        if (!this._termToConcepts.has(key)) this._termToConcepts.set(key, []);
        this._termToConcepts.get(key).push(conceptId);
      }
    }
  }

  get dim() {
    return this._dim;
  }

  /** @param {string} text @returns {Float64Array} L2-normalized vector */
  embed(text) {
    const vec = new Float64Array(this._dim);
    const tokens = tokenize(text);

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // 1. raw word feature -> hashed block
      addHashed(vec, `w:${tok}`, WORD_WEIGHT, this._conceptCount, this._hashDim);

      // 2. bigram feature (captures short phrases like "winter coat")
      if (i + 1 < tokens.length) {
        addHashed(vec, `b:${tok}_${tokens[i + 1]}`, BIGRAM_WEIGHT, this._conceptCount, this._hashDim);
      }

      // 3. concept/synonym features -> reserved, collision-free dimensions
      const concepts = this._termToConcepts.get(tok);
      if (concepts) {
        for (const c of concepts) vec[this._conceptIndex.get(c)] += CONCEPT_WEIGHT;
      }
    }

    l2normalize(vec);
    return vec;
  }
}

/** Lowercase, strip punctuation, split, drop stopwords, light singularization. */
export function tokenize(text) {
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .map(singularize);
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with',
  'my', 'your', 'i', 'is', 'are', 'this', 'that', 'it',
]);

function singularize(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  // Only strip "es" after a sibilant (boxes->box, watches->watch); otherwise
  // "es" words like headphones/shoes/stores keep their stem-final "e".
  if (word.length > 4 && /(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Signed feature hashing into the hashed block [offset, offset+span). */
function addHashed(vec, feature, weight, offset, span) {
  const h = fnv1a(feature);
  const idx = offset + (h % span);
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[idx] += sign * weight;
}

/** 32-bit FNV-1a hash. Deterministic across runs and platforms. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** Cosine similarity of two equal-length vectors. Inputs may be unnormalized. */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
