/**
 * NeuralEmbedder — a real, free, open-source embedding model running IN-PROCESS
 * via transformers.js (@huggingface/transformers). No API key, no per-token cost,
 * no server: the model weights are downloaded once and cached locally, then run
 * on the CPU. This is the "best free version" — genuine learned semantic
 * dimensions (768 for the default bge-base), not hand-curated concepts.
 *
 * Default model: Xenova/bge-base-en-v1.5 (768 dims, strong retrieval quality).
 * Smaller/faster: Xenova/bge-small-en-v1.5 or Xenova/all-MiniLM-L6-v2 (384).
 * Larger/closer-to-1000: Xenova/bge-large-en-v1.5 (1024).
 *
 * Like RemoteEmbedder, fetching is async (model load + inference) but the engine
 * embeds synchronously, so vectors are produced in batches via warm()/embedBatch()
 * and cached; embed() then serves them from cache. Use createShoppingSystemAsync
 * and the engine's *Async methods.
 *
 * `@huggingface/transformers` is an OPTIONAL dependency, loaded via dynamic import
 * only when this class is actually used — so the core library stays lightweight
 * and runs with zero dependencies. A `pipelineFactory` can be injected for tests.
 */

import { Embedder } from './embedder.js';

const DEFAULT_MODEL = 'Xenova/bge-base-en-v1.5';
const DEFAULT_DIM = 768;

export class NeuralEmbedder extends Embedder {
  /**
   * @param {object} [opts]
   * @param {string} [opts.model]     HF model id (must have ONNX weights)
   * @param {number} [opts.dim]       expected dim (auto-corrected after first run)
   * @param {string} [opts.cacheDir]  where to cache downloaded weights (default ./.models)
   * @param {number} [opts.batchSize=32]
   * @param {Function} [opts.pipelineFactory] async (model) => extractor, for tests/custom loaders
   * @param {Map} [opts.cache]
   */
  constructor({ model = DEFAULT_MODEL, dim = DEFAULT_DIM, cacheDir = './.models', batchSize = 32, pipelineFactory, cache } = {}) {
    super();
    this.model = model;
    this._dim = dim;
    this.cacheDir = cacheDir;
    this.batchSize = batchSize;
    this._pipelineFactory = pipelineFactory ?? null;
    this._extractor = null;
    this._cache = cache ?? new Map();
  }

  get dim() {
    return this._dim;
  }

  /** Lazily load the model pipeline (downloads weights on first call). */
  async _init() {
    if (this._extractor) return;
    if (this._pipelineFactory) {
      this._extractor = await this._pipelineFactory(this.model);
      return;
    }
    let tf;
    try {
      tf = await import('@huggingface/transformers');
    } catch {
      throw new Error(
        'NeuralEmbedder needs the optional dependency "@huggingface/transformers". ' +
          'Install it with: npm install @huggingface/transformers',
      );
    }
    if (this.cacheDir) tf.env.cacheDir = this.cacheDir;
    this._extractor = await tf.pipeline('feature-extraction', this.model);
  }

  /** Embed and cache any uncached texts (mean-pooled, L2-normalized). */
  async warm(texts) {
    const missing = [];
    const seen = new Set();
    for (const t of texts) {
      const key = norm(t);
      if (!this._cache.has(key) && !seen.has(key)) {
        seen.add(key);
        missing.push(t);
      }
    }
    if (!missing.length) return;
    await this._init();
    for (let i = 0; i < missing.length; i += this.batchSize) {
      const batch = missing.slice(i, i + this.batchSize);
      const output = await this._extractor(batch, { pooling: 'mean', normalize: true });
      const vectors = output.tolist();
      vectors.forEach((v, j) => this._cache.set(norm(batch[j]), Float64Array.from(v)));
      if (vectors[0]) this._dim = vectors[0].length;
    }
  }

  /** Synchronous read from cache; throws if the text was never warmed. */
  embed(text) {
    const v = this._cache.get(norm(text));
    if (!v) {
      throw new Error(
        `NeuralEmbedder: "${truncate(text)}" not warmed. Call warm()/embedBatch() ` +
          '(or use createShoppingSystemAsync / *Async engine methods) first.',
      );
    }
    return v;
  }

  async embedBatch(texts) {
    await this.warm(texts);
    return texts.map((t) => this.embed(t));
  }
}

function norm(t) {
  return String(t).toLowerCase().replace(/\s+/g, ' ').trim();
}

function truncate(s, n = 60) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}
