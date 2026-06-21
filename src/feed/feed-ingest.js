/**
 * Feed ingestion — read a merchant's product feed in the real Google
 * (Content API / Merchant Center) format, plus the Google Ads Search Terms
 * report. Both are normalized into the shapes the analyzer works with.
 *
 * The feed spec fields handled (https://support.google.com/merchants/answer/7052112):
 *   id, title, description, link, image_link, availability, price,
 *   google_product_category, product_type, brand, gtin, mpn, condition,
 *   color, size, material, gender, age_group, pattern, item_group_id.
 *
 * Two input formats are supported:
 *   - JSON array of feed objects
 *   - TSV (tab-separated, the Content API supplemental-feed format)
 */

const ATTRIBUTE_FIELDS = ['color', 'size', 'material', 'gender', 'age_group', 'pattern'];

/**
 * @param {string|object[]} input  JSON string, TSV string, or parsed array
 * @param {import('../taxonomy/taxonomy.js').Taxonomy} [taxonomy] to resolve GPC
 * @returns {Array<{raw:object, provided:Set<string>, product:object}>}
 */
export function ingestFeed(input, taxonomy = null) {
  const rows = Array.isArray(input) ? input : parseFeedString(input);
  return rows.map((raw) => ({
    raw,
    provided: providedFields(raw),
    product: normalizeFeedItem(raw, taxonomy),
  }));
}

/** Detect JSON vs TSV and parse to an array of plain objects. */
function parseFeedString(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  // TSV
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => {
      if (cells[i] != null && cells[i] !== '') obj[h] = cells[i];
    });
    return obj;
  });
}

/** Which meaningful feed fields the merchant actually supplied. */
function providedFields(raw) {
  const set = new Set();
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && String(v).trim() !== '') set.add(k);
  }
  return set;
}

/** Map a raw feed item onto the internal product shape used by the engine. */
function normalizeFeedItem(raw, taxonomy) {
  const attributes = {};
  for (const f of ATTRIBUTE_FIELDS) {
    if (raw[f] != null && String(raw[f]).trim() !== '') {
      attributes[f === 'age_group' ? 'age_group' : f] = String(raw[f]).toLowerCase();
    }
  }

  const { price, currency } = parsePrice(raw.price);
  const categoryId = resolveCategory(raw.google_product_category, taxonomy);

  return {
    id: String(raw.id ?? raw.offer_id ?? ''),
    title: raw.title ?? '',
    description: raw.description ?? '',
    brand: raw.brand ?? null,
    price,
    currency,
    categoryId,
    attributes,
    inStock: parseAvailability(raw.availability),
    rating: raw.rating != null ? Number(raw.rating) : undefined,
    reviewCount: raw.review_count != null ? Number(raw.review_count) : undefined,
  };
}

function parsePrice(value) {
  if (value == null) return { price: null, currency: 'USD' };
  const m = String(value).match(/([0-9][0-9.,]*)\s*([A-Z]{3})?/);
  if (!m) return { price: null, currency: 'USD' };
  return { price: Number(m[1].replace(/,/g, '')), currency: m[2] ?? 'USD' };
}

function parseAvailability(value) {
  if (value == null) return true;
  return /in[\s_-]?stock|preorder|backorder|available/i.test(String(value));
}

function resolveCategory(value, taxonomy) {
  if (value == null || value === '') return null;
  if (/^\d+$/.test(String(value))) return Number(value);
  if (taxonomy) {
    const node = taxonomy.getByPath(String(value));
    if (node) return node.id;
  }
  return null;
}

/**
 * Ingest a Google Ads / PMax Search Terms report (CSV) into a query universe.
 * Recognizes common column names; value defaults to conversions, then clicks,
 * then impressions.
 * @param {string} csv
 * @returns {Array<{query:string, value:number, impressions:number, clicks:number, conversions:number}>}
 */
export function ingestSearchTerms(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase());

  const col = (...names) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const qi = col('search term', 'query', 'search_term');
  const ii = col('impr');
  const ci = col('click');
  const vi = col('conversion', 'conv');

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delim);
    const query = (cells[qi] ?? '').trim().replace(/^"|"$/g, '');
    if (!query) continue;
    const impressions = num(cells[ii]);
    const clicks = num(cells[ci]);
    const conversions = num(cells[vi]);
    const value = conversions > 0 ? conversions * 100 : clicks > 0 ? clicks * 10 : impressions;
    out.push({ query, value, impressions, clicks, conversions });
  }
  return out;
}

function splitCsvLine(line, delim) {
  if (delim === '\t') return line.split('\t');
  // Minimal CSV split that respects quoted fields.
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
