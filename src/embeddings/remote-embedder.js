/**
 * RemoteEmbedder — a real embedding model behind the same `Embedder` interface.
 *
 * Talks to an OpenAI-compatible embeddings endpoint (works with OpenAI, Vertex's
 * compatible layer, Voyage, or a self-hosted bge/e5 server):
 *
 *     POST {apiUrl}
 *     { "model": "<model>", "input": ["text a", "text b"] }
 *     -> { "data": [ { "embedding": [...] }, ... ] }
 *
 * Because HTTP is async but the engine embeds synchronously, vectors are fetched
 * in batches via `warm()` / `embedBatch()` and cached; `embed()` then serves them
 * synchronously from cache. Call `warm(texts)` (or use the engine's *Async
 * methods / createShoppingSystemAsync) before any synchronous `embed`.
 *
 * `fetchImpl` is injectable so this is fully testable without a network.
 */

import { Embedder } from './embedder.js';

export class RemoteEmbedder extends Embedder {
  /**
   * @param {object} opts
   * @param {string} opts.apiUrl
   * @param {string} [opts.apiKey]
   * @param {string} [opts.model]
   * @param {number} [opts.dim]            expected dimensionality (for validation)
   * @param {number} [opts.batchSize=64]
   * @param {number} [opts.timeoutMs=30000]
   * @param {Function} [opts.fetchImpl]    defaults to global fetch
   * @param {Map|object} [opts.cache]      anything with get/set/has
   * @param {Function} [opts.parseResponse] (json) => number[][]
   */
  constructor({
    apiUrl,
    apiKey,
    model = 'text-embedding-3-small',
    dim = 1536,
    batchSize = 64,
    timeoutMs = 30000,
    fetchImpl,
    cache,
    parseResponse,
  } = {}) {
    super();
    if (!apiUrl) throw new Error('RemoteEmbedder requires an apiUrl');
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this._dim = dim;
    this.batchSize = batchSize;
    this.timeoutMs = timeoutMs;
    this._fetch = fetchImpl ?? globalThis.fetch;
    this._cache = cache ?? new Map();
    this._parseResponse = parseResponse ?? defaultParse;
    if (typeof this._fetch !== 'function') {
      throw new Error('RemoteEmbedder requires a fetch implementation');
    }
  }

  get dim() {
    return this._dim;
  }

  /** Synchronous read from cache. Throws if the text was never warmed. */
  embed(text) {
    const key = norm(text);
    const v = this._cache.get(key);
    if (!v) {
      throw new Error(
        `RemoteEmbedder: "${truncate(text)}" not warmed. ` +
          'Call warm()/embedBatch() (or use createShoppingSystemAsync / *Async engine methods) first.',
      );
    }
    return v;
  }

  /** Fetch and cache vectors for any uncached texts. */
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
    for (let i = 0; i < missing.length; i += this.batchSize) {
      const batch = missing.slice(i, i + this.batchSize);
      const vectors = await this._request(batch);
      batch.forEach((t, j) => this._cache.set(norm(t), Float64Array.from(vectors[j])));
    }
  }

  /** @param {string[]} texts @returns {Promise<Float64Array[]>} */
  async embedBatch(texts) {
    await this.warm(texts);
    return texts.map((t) => this.embed(t));
  }

  async _request(inputs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await safeText(res);
        throw new Error(`embeddings API ${res.status}: ${truncate(body, 200)}`);
      }
      const json = await res.json();
      const vectors = this._parseResponse(json);
      if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
        throw new Error(`embeddings API returned ${vectors?.length} vectors for ${inputs.length} inputs`);
      }
      if (vectors[0] && this._dim !== vectors[0].length) this._dim = vectors[0].length;
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }
}

function defaultParse(json) {
  // OpenAI-compatible shape: { data: [ { embedding: [...] }, ... ] }
  if (json && Array.isArray(json.data)) return json.data.map((d) => d.embedding);
  // Some servers return { embeddings: [[...], ...] }
  if (json && Array.isArray(json.embeddings)) return json.embeddings;
  throw new Error('unrecognized embeddings response shape');
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function norm(t) {
  return String(t).toLowerCase().replace(/\s+/g, ' ').trim();
}

function truncate(s, n = 60) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}
