/**
 * Compliance / disapproval-risk simulator — estimate how likely Google Merchant
 * Center is to disapprove (or warn on) an individual product, before the feed is
 * ever submitted.
 *
 * A disapproved item is suppressed entirely — it cannot show in Shopping, free
 * listings, or Performance Max — so catching disapproval causes up front is
 * high-leverage. Warnings degrade reach or risk future disapproval but still
 * serve, so they are weighted more lightly.
 *
 * Rules mirror Merchant Center policy and the product data spec
 * (https://support.google.com/merchants/answer/6149970):
 *   - hard requirements: image_link, link, a positive price, a product
 *     identifier (gtin / mpn / brand), and for apparel: age_group, gender,
 *     color, size
 *   - policy/quality warnings: all-caps or promotional titles, over-long titles,
 *     missing availability / condition, brand present but no gtin
 *
 * Output is a 0-100 risk score (higher = worse), a willLikelyDisapprove flag,
 * and a list of structured issues the optimizer turns into fixes.
 */

const PROMO_TITLE = /free shipping|best price|lowest price|sale|buy now|%\s*off|cheap|!!!|call now|\+?\d[\d\s().-]{6,}\d|https?:\/\/\S+/i;

const SCORE = { disapproval: 25, warning: 8 };

/**
 * Estimate Merchant Center disapproval/policy risk for one product.
 * @param {object} args
 * @param {object} args.raw  the raw Google feed item (id, title, image_link, …)
 * @param {object} args.product  normalized product { id, price, categoryId, attributes }
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} args.taxonomy
 * @returns {{ riskScore:number, willLikelyDisapprove:boolean, issues:Array<{code:string, severity:'disapproval'|'warning', message:string}> }}
 */
export function checkCompliance({ raw = {}, product = {}, taxonomy }) {
  const issues = [];

  // Hard requirements — missing any of these disapproves the item.
  if (!has(raw.image_link)) {
    issues.push(issue('missing_image_link', 'disapproval', 'Missing image_link; items without an image are disapproved.'));
  }
  if (!has(raw.link)) {
    issues.push(issue('missing_link', 'disapproval', 'Missing link (landing page); a valid landing page is required.'));
  }

  const price = parsePriceValue(raw.price, product.price);
  if (price == null || price <= 0) {
    issues.push(issue('missing_price', 'disapproval', 'Missing or non-positive price; a price greater than 0 is required.'));
  }

  // Product identifiers.
  const hasGtin = has(raw.gtin);
  const hasMpn = has(raw.mpn);
  const hasBrand = has(raw.brand);
  if (!hasGtin && !hasMpn && !hasBrand) {
    issues.push(issue('missing_identifier', 'disapproval', 'No product identifier (gtin, mpn, or brand); at least one is required.'));
  } else if (hasBrand && !hasGtin) {
    issues.push(issue('missing_gtin', 'warning', 'Brand present but no gtin; supplying a gtin improves matching and avoids disapproval risk.'));
  }

  // Title quality / policy.
  const title = has(raw.title) ? String(raw.title) : '';
  if (title.length > 4 && isAllCaps(title)) {
    issues.push(issue('title_all_caps', 'warning', 'policy: avoid all caps in the title.'));
  }
  if (title && PROMO_TITLE.test(title)) {
    issues.push(issue('title_promotional', 'warning', 'policy: avoid promotional text, phone numbers, or URLs in the title.'));
  }
  if (title.length > 150) {
    issues.push(issue('title_too_long', 'warning', `Title is ${title.length} chars; over 150 will be truncated.`));
  }

  // Recommended-but-expected attributes.
  if (!has(raw.availability)) {
    issues.push(issue('missing_availability', 'warning', 'Missing availability.'));
  }
  if (!has(raw.condition)) {
    issues.push(issue('missing_condition', 'warning', 'Missing condition.'));
  }

  // Apparel-specific required attributes.
  if (isApparelCategory(product.categoryId, taxonomy)) {
    for (const f of ['age_group', 'gender', 'color', 'size']) {
      if (!has(raw[f])) {
        issues.push(issue(`apparel_missing_${f}`, 'disapproval', `Apparel item missing required attribute: ${f}.`));
      }
    }
  }

  let riskScore = 0;
  let willLikelyDisapprove = false;
  for (const i of issues) {
    riskScore += SCORE[i.severity];
    if (i.severity === 'disapproval') willLikelyDisapprove = true;
  }

  return { riskScore: clamp(riskScore), willLikelyDisapprove, issues };
}

/** A raw feed value counts as present only if it is a non-empty string. */
function has(value) {
  return value != null && String(value).trim() !== '';
}

/** Prefer the normalized product price; fall back to parsing the raw price. */
function parsePriceValue(rawPrice, productPrice) {
  if (productPrice != null && Number.isFinite(Number(productPrice))) return Number(productPrice);
  if (!has(rawPrice)) return null;
  const m = String(rawPrice).match(/([0-9][0-9.,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** True when more than 60% of alphabetic characters are uppercase. */
function isAllCaps(title) {
  const letters = title.replace(/[^a-zA-Z]/g, '');
  if (!letters.length) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.6;
}

function isApparelCategory(categoryId, taxonomy) {
  if (categoryId == null || !taxonomy) return false;
  const path = taxonomy.ancestors(categoryId).map((n) => n.name).join(' > ');
  // Size/gender/age_group are required for clothing & footwear — not for the
  // rest of "Apparel & Accessories" (handbags, jewelry, belts, etc.).
  return /clothing|shoes|footwear/i.test(path);
}

function issue(code, severity, message) {
  return { code, severity, message };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
