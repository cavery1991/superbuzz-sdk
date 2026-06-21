/**
 * Image auditor — scores how well a product's imagery is set up for Google
 * Shopping, where image quality and coverage drive CTR and product matching.
 *
 * Works fully offline on feed metadata (image links, declared dimensions), and
 * exposes a pluggable async vision-analyzer seam so richer checks (true pixel
 * dimensions, white-background detection, content tags) can be layered in later
 * without changing the calling code.
 *
 * Heuristics mirror Merchant Center image guidance:
 *   - a main image is required
 *   - multiple angles help (recommend at least 3 images total)
 *   - resolution should be >=800px on the longest side (1200+ is better)
 *   - a lifestyle / in-context shot complements plain white-background photos
 *
 * Output is a 0-100 score plus structured issues the optimizer turns into
 * concrete recommendations.
 */

const PENALTY = { high: 50, medium: 15, low: 5 };
const MIN_IMAGES = 3;
const MIN_DIMENSION = 800;

/**
 * Parse all image URLs for a feed item into a single ordered, deduped list.
 *
 * The main `image_link` comes first, followed by `additional_image_link`, which
 * may be an array, a single string, or a `;`/`,`-separated string.
 *
 * @param {object} [raw] the raw feed item
 * @returns {string[]} image URLs, main first, deduped, with blanks removed
 */
export function parseImageList(raw = {}) {
  const out = [];
  const main = raw && raw.image_link;
  if (typeof main === 'string' && main.trim()) out.push(main.trim());

  const extra = raw && raw.additional_image_link;
  for (const url of toList(extra)) out.push(url);

  return [...new Set(out)];
}

/**
 * Audit a product's imagery for Google Shopping readiness.
 *
 * @param {object} args
 * @param {object} args.raw the raw feed item; may contain image_link,
 *   additional_image_link, image_width, image_height, lifestyle_image_link
 * @param {(imageUrl:string)=>Promise<{width?:number,height?:number,hasWhiteBackground?:boolean,tags?:string[]}>} [args.visionAnalyzer]
 *   optional async analyzer run on the main image; its results override missing
 *   metadata and supply content tags
 * @returns {Promise<{score:number,imageCount:number,issues:Array<{code:string,severity:'high'|'medium'|'low',message:string}>,visionTags:string[]}>}
 */
export async function auditImages({ raw = {}, visionAnalyzer } = {}) {
  const issues = [];
  let score = 100;
  const visionTags = [];

  const images = parseImageList(raw);
  const imageCount = images.length;

  // Optionally enrich the main image with vision analysis.
  let vision = null;
  if (typeof visionAnalyzer === 'function' && images.length > 0) {
    vision = await visionAnalyzer(images[0]);
    if (vision && Array.isArray(vision.tags)) {
      for (const t of vision.tags) visionTags.push(t);
    }
  }

  // No main image — the most severe problem; floors the score.
  if (!(typeof raw.image_link === 'string' && raw.image_link.trim())) {
    issues.push(issue('no_image', 'high', 'Missing image_link; a main product image is required.'));
    score -= PENALTY.high;
  }

  // Coverage — multiple angles improve CTR and matching.
  if (imageCount < MIN_IMAGES) {
    issues.push(issue('few_images', 'medium',
      `Only ${imageCount} image${imageCount === 1 ? '' : 's'}; add more angles (aim for at least ${MIN_IMAGES}).`));
    score -= PENALTY.medium;
  }

  // Resolution — prefer declared metadata, fall back to vision.
  const width = numberOr(raw.image_width, vision && vision.width);
  const height = numberOr(raw.image_height, vision && vision.height);
  const maxDim = Math.max(width || 0, height || 0);
  if (maxDim > 0 && maxDim < MIN_DIMENSION) {
    issues.push(issue('low_resolution', 'medium',
      `Image is low resolution (${maxDim}px); Google recommends >=${MIN_DIMENSION}px, ideally 1200+.`));
    score -= PENALTY.medium;
  }

  // Lifestyle — a plain white-background catalog shot benefits from an
  // in-context photo. With no vision data we assume a plain shot.
  const hasLifestyle = typeof raw.lifestyle_image_link === 'string' && raw.lifestyle_image_link.trim();
  const visionSaysWhite = !vision || vision.hasWhiteBackground === true;
  if (!hasLifestyle && visionSaysWhite) {
    issues.push(issue('no_lifestyle', 'low', 'Add a lifestyle/in-context shot to complement the catalog image.'));
    score -= PENALTY.low;
  }

  return { score: clamp(score), imageCount, issues, visionTags };
}

/**
 * Normalize an additional-image value into a clean list of URLs.
 * @param {*} value array, string, `;`/`,`-separated string, or nullish
 * @returns {string[]}
 */
function toList(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[;,]/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function numberOr(primary, fallback) {
  if (typeof primary === 'number' && Number.isFinite(primary)) return primary;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  return 0;
}

function issue(code, severity, message) {
  return { code, severity, message };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
