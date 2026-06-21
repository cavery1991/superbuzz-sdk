/**
 * Feed content generator — the "apply" step that closes the loop.
 *
 * The analyzer finds gaps; this writes the optimized copy that fills them. Two
 * providers behind one interface:
 *
 *   - TemplateGenerator : offline, deterministic. Composes a Google-compliant
 *                         title and a structured description from the product's
 *                         attributes, category, and review/image-derived signals.
 *                         No network, no key — always available.
 *   - LLMGenerator      : calls an OpenAI-compatible chat endpoint to write
 *                         natural, policy-aware copy, with an injectable fetch.
 *                         Falls back to the template provider on any error.
 *
 * `createGenerator()` selects the provider from options/env and degrades to the
 * template generator when no key is configured — mirroring the embedder factory.
 *
 * Google title best practices encoded here: lead with brand, include the key
 * distinguishing attributes (color/material/size) and the head noun, keep within
 * the 150-char limit, and avoid promotional/ALL-CAPS text.
 */

const TITLE_MAX = 150;

/** @typedef {{title:string, description:string, provider:string}} GeneratedContent */

/**
 * Offline, deterministic generator. Always available.
 */
export class TemplateGenerator {
  get name() {
    return 'template';
  }

  /**
   * @param {object} args
   * @param {object} args.raw         raw feed item
   * @param {object} args.product     normalized product (attributes, categoryId)
   * @param {import('../taxonomy/taxonomy.js').Taxonomy} [args.taxonomy]
   * @param {string[]} [args.derivedTags]  review/vision-derived signals to surface
   * @param {string[]} [args.gapTerms]     competitor/query terms worth including
   * @returns {Promise<GeneratedContent>}
   */
  async generate({ raw, product, taxonomy, derivedTags = [], gapTerms = [] }) {
    const attrs = product.attributes ?? {};
    const noun = headNoun(raw.title ?? '', product, taxonomy);

    // Title: Brand + Color + Material + Noun [+ key gap term] [- Size]
    const parts = [];
    if (raw.brand) parts.push(cap(raw.brand));
    if (attrs.color) parts.push(cap(attrs.color));
    if (attrs.material) parts.push(cap(attrs.material));
    if (noun) parts.push(noun);
    const gapInTitle = gapTerms.find((t) => !parts.join(' ').toLowerCase().includes(t.toLowerCase()));
    if (gapInTitle) parts.push(cap(gapInTitle));
    let title = parts.filter(Boolean).join(' ');
    if (attrs.size && !title.toLowerCase().includes('size')) title += ` - Size ${String(attrs.size).toUpperCase()}`;
    title = clampTitle(title || (raw.title ?? ''));

    // Description: existing copy + attribute sentence + surfaced signals.
    const base = (raw.description ?? '').trim();
    const attrSentence = describeAttributes(raw.brand, noun, attrs);
    const signals = uniq([...derivedTags, ...gapTerms]).slice(0, 6);
    const signalSentence = signals.length
      ? `Customers highlight: ${signals.join(', ')}.`
      : '';
    const description = [base, attrSentence, signalSentence]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 5000);

    return { title, description, provider: this.name };
  }
}

/**
 * LLM-backed generator (OpenAI-compatible chat completions). Falls back to the
 * template generator if the request fails or returns unusable output.
 */
export class LLMGenerator {
  /**
   * @param {object} opts
   * @param {string} opts.apiUrl     chat completions endpoint
   * @param {string} [opts.apiKey]
   * @param {string} [opts.model]
   * @param {Function} [opts.fetchImpl]
   * @param {number} [opts.timeoutMs=30000]
   * @param {TemplateGenerator} [opts.fallback]
   */
  constructor({ apiUrl, apiKey, model = 'gpt-4o-mini', fetchImpl, timeoutMs = 30000, fallback } = {}) {
    if (!apiUrl) throw new Error('LLMGenerator requires an apiUrl');
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this._fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.fallback = fallback ?? new TemplateGenerator();
  }

  get name() {
    return 'llm';
  }

  async generate(args) {
    try {
      const prompt = buildPrompt(args);
      const json = await this._chat(prompt);
      const content = extractContent(json);
      const parsed = parseJsonLoose(content);
      if (parsed && parsed.title) {
        return {
          title: clampTitle(String(parsed.title)),
          description: String(parsed.description ?? '').slice(0, 5000),
          provider: this.name,
        };
      }
    } catch {
      /* fall through to template */
    }
    return this.fallback.generate(args);
  }

  async _chat(userPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`chat API ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Select a generator from options/env; fall back to the offline template
 * generator when no LLM is configured.
 * @param {object} [opts]
 * @param {object} [env]
 * @returns {TemplateGenerator|LLMGenerator}
 */
export function createGenerator(opts = {}, env = process.env) {
  const provider = (opts.provider ?? env.GENERATOR_PROVIDER ?? 'template').toLowerCase();
  if (provider === 'template' || provider === 'local') return new TemplateGenerator();
  if (provider === 'llm' || provider === 'openai') {
    const apiKey = opts.apiKey ?? env.GENERATOR_API_KEY ?? env.OPENAI_API_KEY;
    if (!apiKey && !opts.fetchImpl) {
      console.warn('[generator] no API key configured; using offline TemplateGenerator');
      return new TemplateGenerator();
    }
    return new LLMGenerator({
      apiUrl: opts.apiUrl ?? env.GENERATOR_API_URL ?? 'https://api.openai.com/v1/chat/completions',
      apiKey,
      model: opts.model ?? env.GENERATOR_MODEL ?? 'gpt-4o-mini',
      fetchImpl: opts.fetchImpl,
    });
  }
  console.warn(`[generator] unknown provider "${provider}"; using TemplateGenerator`);
  return new TemplateGenerator();
}

const SYSTEM_PROMPT =
  'You are a Google Shopping feed copywriter. Write an optimized product title and ' +
  'description that maximize relevance for how shoppers search. Rules: lead the title ' +
  'with the brand, include the most search-relevant attributes (color, material, size) ' +
  'and the product type; keep the title under 150 characters; no ALL CAPS, no ' +
  'promotional text ("free shipping", "sale", "!!!"). Respond ONLY with JSON: ' +
  '{"title": "...", "description": "..."}.';

function buildPrompt({ raw, product, taxonomy, derivedTags = [], gapTerms = [] }) {
  const node = product.categoryId != null && taxonomy ? taxonomy.get(product.categoryId) : null;
  return JSON.stringify({
    current_title: raw.title ?? '',
    current_description: raw.description ?? '',
    brand: raw.brand ?? null,
    google_product_category: node ? node.path : null,
    attributes: product.attributes ?? {},
    review_and_image_signals: derivedTags,
    high_value_search_terms_to_target: gapTerms,
  });
}

// ---- helpers ---------------------------------------------------------------

function describeAttributes(brand, noun, attrs) {
  const bits = [];
  if (attrs.material) bits.push(attrs.material);
  if (attrs.color) bits.push(attrs.color);
  const lead = [brand, ...bits, noun].filter(Boolean).map(cap).join(' ');
  if (!lead) return '';
  const tail = attrs.size ? ` available in size ${String(attrs.size).toUpperCase()}` : '';
  return `${lead}${tail}.`;
}

function headNoun(title, product, taxonomy) {
  const words = String(title).split(/\s+/).filter(Boolean);
  if (words.length) {
    const last = words[words.length - 1];
    if (/^[a-z]/i.test(last) && last.length > 2) return cap(last);
  }
  if (product.categoryId != null && taxonomy) {
    const node = taxonomy.get(product.categoryId);
    if (node) return cap(node.name.replace(/s$/, ''));
  }
  return '';
}

function clampTitle(t) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length <= TITLE_MAX ? s : s.slice(0, TITLE_MAX).replace(/\s+\S*$/, '');
}

function cap(s) {
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function uniq(arr) {
  return [...new Set(arr)];
}

function extractContent(json) {
  return json?.choices?.[0]?.message?.content ?? '';
}

function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
