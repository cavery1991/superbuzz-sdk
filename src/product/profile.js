/**
 * Product semantic profile builder.
 *
 * Google doesn't just read your product title — it crawls your entire digital
 * footprint to build a comprehensive semantic profile. This module fuses the
 * four product-side factor sources into a single enriched representation that
 * the embedder turns into a vector:
 *
 *   1. Feed attributes  : structured Merchant Center data (title, brand, gpc_id,
 *                         price, availability, color/size/material).
 *   2. Schema markup    : Product JSON-LD lifted from the page (schema.org).
 *   3. Computer vision  : tags a vision model detects from images ("striped")
 *                         that the merchant forgot to write.
 *   4. Social proof      : semantic tags mined from reviews / Q&A
 *                         ("kept me dry in a downpour" -> rain protection).
 *
 * The output is a normalized product plus an `enrichedText` blob and a set of
 * `derivedTags`, so nothing about the search engine's contract changes.
 */

// Phrase rules that turn free-text reviews into semantic tags + concepts.
const REVIEW_RULES = [
  { test: /dry|downpour|didn'?t (?:get|soak)|no leak|waterproof/i, tag: 'rain protection', concepts: ['waterproof'] },
  { test: /warm|cozy|toasty|kept me hot|no cold/i, tag: 'warmth', concepts: ['warmth'] },
  { test: /comfortable|comfy|cushioned|all day comfort/i, tag: 'comfortable', concepts: [] },
  { test: /durable|lasted|holds up|sturdy|rugged/i, tag: 'durable', concepts: ['durable'] },
  { test: /lightweight|light as|barely felt/i, tag: 'lightweight', concepts: ['lightweight'] },
  { test: /quiet|blocks? noise|cancell?ed/i, tag: 'noise isolation', concepts: ['noise_cancelling'] },
  { test: /grip|traction|didn'?t slip|stable on/i, tag: 'traction', concepts: ['durable'] },
  { test: /battery|lasts? .* hours|all day power/i, tag: 'long battery life', concepts: [] },
  { test: /true to size|fits perfectly|right size/i, tag: 'accurate sizing', concepts: [] },
];

/**
 * Build a fused product profile.
 * @param {object} input
 * @param {object} [input.feed]      raw feed attributes / base product fields
 * @param {object} [input.schema]    schema.org Product JSON-LD object
 * @param {string[]} [input.visionTags]  tags from computer-vision image analysis
 * @param {Array<string|{text:string,rating?:number}>} [input.reviews]  review text
 * @returns {{ product:object, enrichedText:string, derivedTags:string[], derivedConcepts:string[] }}
 */
export function buildProductProfile(input = {}) {
  const feed = { ...(input.feed ?? {}) };
  const fromSchema = input.schema ? fromJsonLd(input.schema) : {};

  // Merge precedence: explicit feed wins over schema-derived values.
  const merged = { ...fromSchema, ...feed };
  merged.attributes = { ...(fromSchema.attributes ?? {}), ...(feed.attributes ?? {}) };

  const visionTags = (input.visionTags ?? []).map((t) => String(t).toLowerCase());

  // Mine reviews for semantic tags.
  const derivedTags = new Set();
  const derivedConcepts = new Set();
  const reviews = input.reviews ?? [];
  let ratingSum = 0;
  let ratingN = 0;
  for (const r of reviews) {
    const text = typeof r === 'string' ? r : (r.text ?? '');
    if (typeof r === 'object' && typeof r.rating === 'number') {
      ratingSum += r.rating;
      ratingN++;
    }
    for (const rule of REVIEW_RULES) {
      if (rule.test.test(text)) {
        derivedTags.add(rule.tag);
        rule.concepts.forEach((c) => derivedConcepts.add(c));
      }
    }
  }
  for (const t of visionTags) derivedTags.add(t);

  // Roll review ratings into the product if not already supplied.
  if (ratingN > 0 && merged.rating == null) {
    merged.rating = Number((ratingSum / ratingN).toFixed(2));
    merged.reviewCount = (merged.reviewCount ?? 0) + ratingN;
  }

  const enrichedText = [
    merged.title,
    merged.brand,
    merged.description,
    Object.values(merged.attributes ?? {}).join(' '),
    visionTags.join(' '),
    [...derivedTags].join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  return {
    product: merged,
    enrichedText,
    derivedTags: [...derivedTags],
    derivedConcepts: [...derivedConcepts],
  };
}

/** Map a schema.org Product JSON-LD object onto our product shape. */
function fromJsonLd(schema) {
  const out = { attributes: {} };
  if (schema.name) out.title = schema.name;
  if (schema.description) out.description = schema.description;
  if (schema.brand) out.brand = typeof schema.brand === 'string' ? schema.brand : schema.brand.name;
  if (schema.color) out.attributes.color = String(schema.color).toLowerCase();
  if (schema.material) out.attributes.material = String(schema.material).toLowerCase();
  if (schema.size) out.attributes.size = String(schema.size);

  const offer = schema.offers ? (Array.isArray(schema.offers) ? schema.offers[0] : schema.offers) : null;
  if (offer) {
    if (offer.price != null) out.price = Number(offer.price);
    if (offer.priceCurrency) out.currency = offer.priceCurrency;
    if (offer.availability) {
      out.inStock = /InStock|LimitedAvailability|PreOrder/i.test(String(offer.availability));
    }
  }
  const agg = schema.aggregateRating;
  if (agg) {
    if (agg.ratingValue != null) out.rating = Number(agg.ratingValue);
    if (agg.reviewCount != null) out.reviewCount = Number(agg.reviewCount);
  }
  return out;
}
