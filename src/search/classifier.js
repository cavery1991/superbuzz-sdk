/**
 * Category classifier.
 *
 * Before diving into specifics, Google figures out the broad classification of an
 * item — which "digital aisle" (GPC category) it belongs to. This classifier does
 * that by embedding every category's path and finding the nearest one to a piece
 * of text (a product title, or a user's query intent).
 */

import { cosineSimilarity } from '../embeddings/embedder.js';

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
      // Embed the full path; deeper, leaf-ish words repeated for emphasis.
      const text = `${node.parts.join(' ')} ${node.name} ${node.name}`;
      this._index.push({ id: node.id, path: node.path, embedding: this.embedder.embed(text) });
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

  /** Best single category id (or null if nothing scores above 0). */
  bestCategoryId(text) {
    const [top] = this.classify(text, 1);
    return top && top.score > 0 ? top.id : null;
  }
}
