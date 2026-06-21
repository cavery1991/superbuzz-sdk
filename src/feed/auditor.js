/**
 * Feed auditor — scores how well an individual product feed is built and flags
 * the issues that hurt how it gets matched and shown on Google Shopping.
 *
 * Checks mirror Merchant Center requirements and matching best practices:
 *   - required attributes present (id, title, description, link, image, price,
 *     availability, brand / gtin)
 *   - recommended attributes present (google_product_category, product_type,
 *     and for apparel: color, size, gender, age_group, material)
 *   - title quality (length, brand inclusion, key attribute inclusion)
 *   - GPC correctness (present, and consistent with the classifier's read)
 *   - footprint signals (reviews / vision tags) not yet surfaced in the text
 *
 * Output is a 0-100 score plus a list of structured issues the optimizer turns
 * into concrete recommendations.
 */

const REQUIRED = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'];
const RECOMMENDED = ['google_product_category', 'product_type'];
const APPAREL_REQUIRED = ['color', 'size', 'gender', 'age_group'];
const APPAREL_RECOMMENDED = ['material', 'pattern'];

const PENALTY = { required: 15, recommended: 5, title: 10, gpc: 10, gpcMismatch: 8, footprint: 4 };

/**
 * @param {object} args
 * @param {object} args.raw          the raw feed item
 * @param {Set<string>} args.provided fields the merchant supplied
 * @param {object} args.product      normalized product (categoryId, attributes)
 * @param {import('../search/classifier.js').CategoryClassifier} args.classifier
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @param {string[]} [args.derivedTags]  review/vision tags from the profile
 * @returns {{ id:string, score:number, issues:Array<{type:string,field?:string,severity:string,message:string}> }}
 */
export function auditProduct({ raw, provided, product, classifier, taxonomy, derivedTags = [] }) {
  const issues = [];
  let score = 100;

  const isApparel = isApparelCategory(product.categoryId, taxonomy);

  // Required / recommended attribute presence.
  for (const f of REQUIRED) {
    if (!provided.has(f)) {
      issues.push(issue('missing_required', f, 'high', `Missing required attribute: ${f}`));
      score -= PENALTY.required;
    }
  }
  const recommended = isApparel ? [...RECOMMENDED, ...APPAREL_REQUIRED, ...APPAREL_RECOMMENDED] : RECOMMENDED;
  for (const f of recommended) {
    if (!provided.has(f)) {
      const sev = isApparel && APPAREL_REQUIRED.includes(f) ? 'high' : 'medium';
      issues.push(issue('missing_recommended', f, sev, `Missing recommended attribute: ${f}`));
      score -= sev === 'high' ? PENALTY.required : PENALTY.recommended;
    }
  }

  // Title quality.
  const title = String(raw.title ?? '');
  if (title.length > 0) {
    if (title.length < 20) {
      issues.push(issue('title_short', 'title', 'medium', `Title is short (${title.length} chars); aim for 50-150 with key attributes.`));
      score -= PENALTY.title;
    }
    if (raw.brand && !title.toLowerCase().includes(String(raw.brand).toLowerCase())) {
      issues.push(issue('title_no_brand', 'title', 'medium', 'Title does not include the brand.'));
      score -= PENALTY.recommended;
    }
    const missingInTitle = ['color', 'material', 'size']
      .filter((a) => product.attributes[a] && !title.toLowerCase().includes(product.attributes[a]));
    if (missingInTitle.length) {
      issues.push(issue('title_missing_attrs', 'title', 'medium',
        `Title omits attributes shoppers search by: ${missingInTitle.join(', ')}.`));
      score -= PENALTY.recommended;
    }
  }

  // GPC correctness — judged on what the merchant supplied in the feed, not on
  // the category we inferred during indexing.
  if (!provided.has('google_product_category')) {
    const inferred = product.categoryId; // filled in by the engine's classifier
    const node = inferred != null ? taxonomy.get(inferred) : null;
    issues.push(issue('gpc_missing', 'google_product_category', 'high',
      `No google_product_category in the feed` + (node ? ` — content reads as [${inferred}] ${node.path}.` : '.'),
      inferred != null ? { predicted: inferred } : {}));
    score -= PENALTY.gpc;
  } else if (product.categoryId != null) {
    const predicted = classifier.bestCategoryId(`${raw.title ?? ''} ${raw.description ?? ''}`);
    if (predicted != null && predicted !== product.categoryId) {
      const pNode = taxonomy.get(predicted);
      issues.push(issue('gpc_mismatch', 'google_product_category', 'medium',
        `GPC may be wrong: set to [${product.categoryId}] but content reads as [${predicted}] ${pNode?.name ?? ''}.`,
        { predicted }));
      score -= PENALTY.gpcMismatch;
    }
  }

  // Footprint signals not surfaced in the text.
  const text = `${raw.title ?? ''} ${raw.description ?? ''}`.toLowerCase();
  const unsurfaced = derivedTags.filter((t) => !text.includes(String(t).toLowerCase()));
  if (unsurfaced.length) {
    issues.push(issue('footprint_unsurfaced', 'description', 'low',
      `Review/image signals not in your text: ${unsurfaced.slice(0, 4).join(', ')}.`, { tags: unsurfaced }));
    score -= PENALTY.footprint;
  }

  return { id: product.id, score: clamp(score), issues };
}

function isApparelCategory(categoryId, taxonomy) {
  if (categoryId == null) return false;
  const path = taxonomy.ancestors(categoryId).map((n) => n.name).join(' > ').toLowerCase();
  return /apparel|clothing|shoes|footwear/.test(path);
}

function issue(type, field, severity, message, extra = {}) {
  return { type, field, severity, message, ...extra };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
