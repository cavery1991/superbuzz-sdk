/**
 * Server-only wrapper around the shopping-graph engine. All of these run in
 * Node (API route handlers), never in the browser.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  analyzeFeed, createShoppingSystem, ingestFeed, buildProductProfile,
  auditProduct, optimizeProduct, predictAppearance, extractProductFromHtml, scanProduct,
} from 'shopping-graph';

/** Full feed analysis report. */
export function runAnalyze(feed, searchTermsCsv) {
  return analyzeFeed({ feed, searchTermsCsv: searchTermsCsv || undefined });
}

/** Appearance prediction for one query across the uploaded feed. */
export function runPredict(feed, query, appearThreshold = 0.45) {
  const sys = createShoppingSystem();
  const items = ingestFeed(feed, sys.taxonomy);
  const rawById = new Map();
  const optimizedById = new Map();
  for (const it of items) {
    const profile = buildProductProfile({
      feed: it.product, schema: it.raw.schema,
      visionTags: it.raw.visionTags ?? (it.raw.vision_tags ? String(it.raw.vision_tags).split(/[;,|]/) : undefined),
      reviews: it.raw.reviews,
    });
    const stored = sys.engine.index({ ...it.product });
    rawById.set(stored.id, it.raw);
    const audit = auditProduct({ raw: it.raw, provided: it.provided, product: stored, classifier: sys.classifier, taxonomy: sys.taxonomy, derivedTags: profile.derivedTags });
    const opt = optimizeProduct({ raw: it.raw, product: stored, audit, taxonomy: sys.taxonomy, derivedTags: profile.derivedTags, derivedConcepts: profile.derivedConcepts });
    optimizedById.set(stored.id, sys.embedder.embed(opt.optimizedText));
  }
  const out = predictAppearance({ engine: sys.engine, query, appearThreshold, rawById, taxonomy: sys.taxonomy, optimizedById });
  const aisle = out.intentCategoryId != null ? sys.taxonomy.get(out.intentCategoryId) : null;
  return { query, aisle: aisle ? aisle.path : null, counts: out.counts, rows: out.rows };
}

/** Scan a PDP (already-fetched HTML): infer target searches + likelihood. */
export function runScan(html, url) {
  const sys = createShoppingSystem();
  const extracted = extractProductFromHtml(html, { url });
  if (!extracted.title) return { error: 'No product found (no JSON-LD / OpenGraph / title).' };
  const stored = sys.engine.index({ ...extracted });
  const out = scanProduct({ engine: sys.engine, product: stored, taxonomy: sys.taxonomy });
  const cat = out.product.categoryId != null ? sys.taxonomy.get(out.product.categoryId) : null;
  return {
    product: {
      title: out.product.title, brand: out.product.brand, price: out.product.price,
      inStock: out.product.inStock, categoryPath: cat ? cat.path : null,
    },
    eligible: out.eligible, eligibilityIssues: out.eligibilityIssues, queries: out.queries,
  };
}

/** Bundled sample feed + search terms (from the parent repo's data/). */
export async function getSample() {
  const dir = join(process.cwd(), '..', 'data');
  const [feed, searchTerms] = await Promise.all([
    readFile(join(dir, 'feed.sample.json'), 'utf8'),
    readFile(join(dir, 'search-terms.sample.csv'), 'utf8').catch(() => ''),
  ]);
  return { feed, searchTerms };
}
