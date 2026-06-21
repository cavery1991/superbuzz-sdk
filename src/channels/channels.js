/**
 * Channel syndication — "optimize once, syndicate everywhere".
 *
 * Takes a normalized internal product (the shape produced by
 * src/feed/feed-ingest.js) and maps it onto the field specs required by
 * different sales channels (Google Merchant Center, Meta catalog, an
 * Amazon flat-file). Each channel declares the OUTPUT fields it needs so
 * callers can flag channel-specific gaps before uploading.
 *
 * Normalized product shape:
 *   { id, title, description, brand, price (number|null), currency,
 *     categoryId (number|null), attributes:{color,size,material,...},
 *     inStock (bool), link?, image_link?, gtin?, mpn?, condition? }
 */

/** A value counts as "present" when it is non-null and non-empty. */
function present(value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Assign source onto target under key only when source is present.
 * @param {object} target  output record being built
 * @param {string} key  output field name
 * @param {*} value  candidate source value
 */
function put(target, key, value) {
  if (present(value)) target[key] = value;
}

/** Format a price + currency as the "12.00 USD" string channels expect. */
function priceString(price, currency) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  return `${Number(price).toFixed(2)} ${currency || 'USD'}`;
}

/** Map internal inStock boolean to the 'in stock' | 'out of stock' string. */
function availabilityString(inStock) {
  return inStock ? 'in stock' : 'out of stock';
}

const attr = (product, name) => product?.attributes?.[name];

/**
 * Supported sales channels. Each entry exposes:
 *   - id: stable channel key
 *   - label: human-readable name
 *   - required: output field names a complete record must carry
 *   - map(product): produce an output record (null/empty keys omitted)
 * @type {Record<string, {id:string, label:string, required:string[], map:(product:object)=>object}>}
 */
export const CHANNELS = {
  google: {
    id: 'google',
    label: 'Google Merchant Center',
    required: ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'],
    map(product) {
      const out = {};
      put(out, 'id', product.id);
      put(out, 'title', product.title);
      put(out, 'description', product.description);
      put(out, 'link', product.link);
      put(out, 'image_link', product.image_link);
      out.availability = availabilityString(product.inStock);
      put(out, 'price', priceString(product.price, product.currency));
      put(out, 'brand', product.brand);
      put(out, 'google_product_category', product.categoryId);
      put(out, 'color', attr(product, 'color'));
      put(out, 'size', attr(product, 'size'));
      put(out, 'material', attr(product, 'material'));
      put(out, 'gtin', product.gtin);
      put(out, 'condition', product.condition);
      return out;
    },
  },

  meta: {
    id: 'meta',
    label: 'Meta (Facebook/Instagram) Catalog',
    required: ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link'],
    map(product) {
      const out = {};
      put(out, 'id', product.id);
      put(out, 'title', product.title);
      put(out, 'description', product.description);
      out.availability = availabilityString(product.inStock);
      out.condition = present(product.condition) ? product.condition : 'new';
      put(out, 'price', priceString(product.price, product.currency));
      put(out, 'link', product.link);
      put(out, 'image_link', product.image_link);
      put(out, 'brand', product.brand);
      put(out, 'google_product_category', product.categoryId);
      put(out, 'color', attr(product, 'color'));
      put(out, 'size', attr(product, 'size'));
      return out;
    },
  },

  amazon: {
    id: 'amazon',
    label: 'Amazon (simplified flat-file)',
    required: ['sku', 'product-name', 'standard-price'],
    map(product) {
      const out = {};
      put(out, 'sku', product.id);
      put(out, 'product-name', product.title);
      put(out, 'product-description', product.description);
      if (product.price != null && Number.isFinite(Number(product.price))) {
        out['standard-price'] = Number(product.price);
      }
      put(out, 'brand', product.brand);
      out['condition-type'] = present(product.condition) ? product.condition : 'New';
      put(out, 'color', attr(product, 'color'));
      put(out, 'size', attr(product, 'size'));
      put(out, 'external-product-id', product.gtin);
      return out;
    },
  },
};

/**
 * Map a list of normalized products to a channel's output record spec.
 * @param {object[]} products  normalized products
 * @param {string} channel  one of the CHANNELS keys ('google'|'meta'|'amazon')
 * @returns {object[]} mapped output records
 * @throws {Error} if the channel is unknown
 */
export function exportForChannel(products, channel) {
  const spec = CHANNELS[channel];
  if (!spec) {
    throw new Error(
      `Unknown channel "${channel}". Supported channels: ${Object.keys(CHANNELS).join(', ')}.`,
    );
  }
  return (products || []).map((p) => spec.map(p));
}

/**
 * Report which of a channel's required OUTPUT fields are missing/empty.
 * @param {object} record  a mapped output record
 * @param {string} channel  one of the CHANNELS keys
 * @returns {string[]} required field names absent or empty in the record
 * @throws {Error} if the channel is unknown
 */
export function missingRequiredFields(record, channel) {
  const spec = CHANNELS[channel];
  if (!spec) {
    throw new Error(
      `Unknown channel "${channel}". Supported channels: ${Object.keys(CHANNELS).join(', ')}.`,
    );
  }
  const rec = record || {};
  return spec.required.filter((field) => !present(rec[field]));
}

/** Replace tabs/newlines in a cell value with a single space. */
function escapeCell(value) {
  if (value == null) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

/**
 * Render records as a tab-separated string. The header row is the union of
 * all keys in first-seen order; each data row carries one record, empty for
 * fields it lacks. Tabs/newlines in values are replaced with spaces.
 * @param {object[]} records
 * @returns {string} TSV text (no trailing newline)
 */
export function toTSV(records) {
  const rows = records || [];
  const headers = [];
  const seen = new Set();
  for (const rec of rows) {
    for (const key of Object.keys(rec || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  const lines = [headers.join('\t')];
  for (const rec of rows) {
    lines.push(headers.map((h) => escapeCell((rec || {})[h])).join('\t'));
  }
  return lines.join('\n');
}
