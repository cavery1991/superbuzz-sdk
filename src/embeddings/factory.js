/**
 * Embedder factory — choose the embedding provider from options or environment,
 * and fall back to the offline LocalEmbedder when a real model isn't configured.
 *
 * Environment variables:
 *   EMBEDDINGS_PROVIDER   "local" (default) | "remote" | "openai"
 *   EMBEDDINGS_API_URL    endpoint (default https://api.openai.com/v1/embeddings)
 *   EMBEDDINGS_API_KEY    API key (also accepts OPENAI_API_KEY)
 *   EMBEDDINGS_MODEL      model id (default text-embedding-3-small)
 *   EMBEDDINGS_DIM        expected dimensionality (default 1536)
 */

import { LocalEmbedder } from './embedder.js';
import { RemoteEmbedder } from './remote-embedder.js';
import { NeuralEmbedder } from './neural-embedder.js';

/**
 * @param {object} [opts] explicit overrides (win over env)
 * @param {string} [opts.provider]
 * @param {string} [opts.apiUrl]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.dim]
 * @param {Function} [opts.fetchImpl]
 * @param {object} [opts.local]   options forwarded to LocalEmbedder
 * @param {object} [env]          environment (defaults to process.env)
 * @returns {import('./embedder.js').Embedder}
 */
export function createEmbedder(opts = {}, env = process.env) {
  const provider = (opts.provider ?? env.EMBEDDINGS_PROVIDER ?? 'local').toLowerCase();

  if (provider === 'local') return new LocalEmbedder(opts.local);

  // Free, in-process open-source model (transformers.js). No key, no cost.
  if (provider === 'neural' || provider === 'local-neural') {
    return new NeuralEmbedder({
      model: opts.model ?? env.EMBEDDINGS_MODEL,
      cacheDir: opts.cacheDir ?? env.EMBEDDINGS_CACHE_DIR,
      pipelineFactory: opts.pipelineFactory,
      cache: opts.cache,
    });
  }

  if (provider === 'remote' || provider === 'openai') {
    const apiKey = opts.apiKey ?? env.EMBEDDINGS_API_KEY ?? env.OPENAI_API_KEY;
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!apiKey && !opts.fetchImpl) {
      // Nothing to authenticate with and no injected client — degrade gracefully.
      console.warn('[embeddings] no API key configured; falling back to LocalEmbedder');
      return new LocalEmbedder(opts.local);
    }
    return new RemoteEmbedder({
      apiUrl: opts.apiUrl ?? env.EMBEDDINGS_API_URL ?? 'https://api.openai.com/v1/embeddings',
      apiKey,
      model: opts.model ?? env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
      dim: opts.dim ?? Number(env.EMBEDDINGS_DIM) ?? 1536,
      fetchImpl,
      cache: opts.cache,
      parseResponse: opts.parseResponse,
      batchSize: opts.batchSize,
    });
  }

  console.warn(`[embeddings] unknown provider "${provider}"; falling back to LocalEmbedder`);
  return new LocalEmbedder(opts.local);
}
