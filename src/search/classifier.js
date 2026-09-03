/**
 * Category classifier.
 *
 * Before diving into specifics, Google figures out the broad classification of an
 * item — which "digital aisle" (GPC category) it belongs to. This classifier does
 * that by embedding every category's path and finding the nearest one to a piece
 * of text (a product title, or a user's query intent).
 */

import { cosineSimilarity } from '../embeddings/embedder.js';

/** The text used to represent a taxonomy node for embedding (leaf emphasized). */
export function categoryEmbedText(node) {
  return `${node.parts.join(' ')} ${node.name} ${node.name}`;
}

export class CategoryClassifier {
  /**
   * @param {import('../taxonomy/taxonomy.js').Taxonomy} taxonomy
   * @param {import('../embeddings/embedder.js').Embedder} embedder
   */
  constructor(taxonomy, embedder) {
    this.taxonomy = taxonomy;
    this.embedder = embedder;
    /** @type {{id:number, path:string, embedding:Float64Array}[]} */
    this._index = [];
    this._build();
  }

  _build() {
    for (const node of this.taxonomy.all()) {
      this._index.push({ id: node.id, path: node.path, embedding: this.embedder.embed(categoryEmbedText(node)) });
    }
  }

  /**
   * Rank categories by semantic closeness to `text`.
   * @param {string} text
   * @param {number} [topK=3]
   * @returns {{id:number, path:string, score:number}[]}
   */
  classify(text, topK = 3) {
    const q = this.embedder.embed(text);
    const scored = this._index.map((c) => ({
      id: c.id,
      path: c.path,
      score: cosineSimilarity(q, c.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Best single category id, or null when nothing matches confidently.
   * The floor matters: without it, an out-of-domain product (e.g. a cosmetic in
   * a catalog whose taxonomy lacks beauty) gets forced into the least-bad — and
   * absurd — category. Returning null instead lets callers say "no category"
   * rather than suggest nonsense.
   */
  bestCategoryId(text, minConfidence = 0.12) {
    const [top] = this.classify(text, 1);
    return top && top.score >= minConfidence ? top.id : null;
  }
}
