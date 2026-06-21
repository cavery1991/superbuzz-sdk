# Shopping Graph

A compact, self-contained implementation of the system behind **Google Shopping**:
the Google Product Category taxonomy ("the number system"), semantic vector
embeddings with cosine similarity, a Shopping Graph product store, query factor
extraction, multi-source product profiles, and real-time contextual re-ranking.

It runs entirely offline (no API keys) and ships with a CLI, a test suite, and a
sample catalog. The embedding provider is pluggable, so a real model
(Vertex AI / MUM / BERT-style) can be swapped in without touching callers.

```bash
node bin/cli.js demo                 # end-to-end walkthrough
node bin/cli.js search "warm winter coat" --explain
node bin/cli.js parse "waterproof black running shoes size 10"
npm test                             # 38 tests
```

---

## How it maps to how Google Shopping works

### Pillar 1 — Google Product Category taxonomy (the number system)
`src/taxonomy/`

A hierarchical tree of categories, each with a unique numeric id and a full path
(e.g. `187 → Apparel & Accessories > Shoes > Athletic Shoes`). It parses Google's
official `taxonomy-with-ids.en-US.txt` format and ships a curated offline subset.
This is the universal language that classifies an item before any detail matching.

```js
const tax = Taxonomy.sample();             // or Taxonomy.fromFile('taxonomy.txt')
tax.get(187).path;                         // "...> Shoes > Athletic Shoes"
tax.ancestors(187);                        // root → leaf chain
```

### Pillar 2 — Semantic embeddings & cosine similarity
`src/embeddings/`

Both queries and products are projected into a high-dimensional vector space where
related concepts sit close together. Relevance is the **cosine similarity** between
the query vector **A** and product vector **B**:

```
similarity = cos(θ) = (A · B) / (‖A‖ ‖B‖)
```

A score near `1.0` is a tight semantic match even with zero shared words — so
"warm winter coat" matches an "Insulated Down Parka". The offline `LocalEmbedder`
reserves a **collision-free dimension per concept** (the semantic backbone, where
synonyms like coat/jacket/parka collapse together) plus a feature-hashed block for
raw words and bigrams (the lexical signal). Concept groups live in
`src/embeddings/concepts.js`.

> Real embedding models learn these "factor map" dimensions (gender, formality,
> seasonality, …) implicitly. Here they're explicit and editable. Implement the
> `Embedder` interface (`dim` + `embed(text)`) to plug in a trained model.

### Pillar 3 — The Shopping Graph
`src/graph/`

The continuously-updated product store. It indexes products by id, brand,
category, and attribute, and understands structured data — color, size, material,
brand, price, availability, ratings, and local inventory. It exposes the
filtering primitives (`filter`, `stats`) the search layer builds on, and is
storage-pluggable (in-memory here; swap for D1/Postgres/Vectorize).

### Query factor extraction
`src/query/query-parser.js`

Deconstructs a search string into logical factors, exactly as described:

| Factor | Example in "waterproof black running shoes size 10" |
|---|---|
| Core entity / head noun | `shoes` → GPC category |
| Visual modifier | `black` → color variant |
| Functional modifier | `waterproof` → feature/material tech |
| Usage modifier | `running` → activity / sub-category |
| Sizing / technical specs | `size 10` (also `4k`, `v2`, `256gb`) → hard filter |
| Implied intent / synonyms | "won't slip on ice" → traction, waterproof, cold weather |

Implied concepts are folded back into the query vector so latent intent shifts the
match — `parse` shows the full breakdown.

### Product semantic profile (the whole digital footprint)
`src/product/profile.js`

A product's vector is built from four fused factor sources:

1. **Feed attributes** — Merchant-Center-style structured fields.
2. **Schema markup** — schema.org `Product` JSON-LD lifted from the page.
3. **Computer vision** — image tags (`striped`, `low-top`) the merchant forgot to
   write, folded into the text profile.
4. **Social proof / reviews** — review text is mined for semantic tags:
   "kept me dry in a downpour" → `rain protection` (+`waterproof` concept), so the
   product matches "waterproof jacket" even if the feed only said "water-resistant".

### Real-time contextual re-ranking
`src/ranking/context.js`

A post-pass that weights the static relevance score by the shopper's situation:

- **Geographic location** — boost products with nearby local inventory (`region`).
- **Device / interface** — on `mobile`, boost in-store-pickup-today items.
- **Historical co-purchasing** — `CoPurchaseModel` nudges results toward what other
  shoppers bought after this exact query (e.g. "dorm room lighting" → LED strips).

---

## Library usage

```js
import { createShoppingSystem, CoPurchaseModel } from './src/index.js';

const sys = createShoppingSystem();           // taxonomy + embedder + graph + engine

sys.engine.index({
  id: 'sku-1',
  title: 'Storm Shell Jacket',
  brand: 'NorthPeak',
  attributes: { color: 'navy' },
  schema: { '@type': 'Product', offers: { price: '180', availability: 'https://schema.org/InStock' } },
  visionTags: ['hooded'],
  reviews: ['kept me totally dry in a downpour'],
  localInventory: { 'US-CA': 5 },
  inStock: true,
});

const { results, intent, parsed } = sys.engine.search('waterproof jacket for rain', {
  inStockOnly: true,
  context: { region: 'US-CA', device: 'mobile' },
});
```

`search()` returns `{ query, parsed, intent, results }`, where each result carries a
`score` and a `breakdown` (semantic / category / attr / quality / stock, plus
`contextScore` when context is supplied).

---

## Architecture

```
src/
  taxonomy/      Taxonomy        — GPC number system (official-format parser + subset)
  embeddings/    LocalEmbedder   — concept-aware vectors + cosineSimilarity
                 concepts.js     — synonym/concept groups (the semantic backbone)
  graph/         ShoppingGraph   — product store, attribute/brand/category indexes
  query/         QueryParser     — query factor extraction & implied intent
  product/       buildProfile    — fuse feed + schema + vision + reviews
  ranking/       applyContext    — geo / device / co-purchase re-ranking
  search/        CategoryClassifier, SearchEngine — the operation tying it together
  index.js       createShoppingSystem(...) + public exports
bin/cli.js       demo / search / parse / classify / taxonomy / index
data/            sample + enriched product catalogs
test/            node:test suites for every module
```

## CLI reference

```
shopping-graph demo
shopping-graph search "<query>" [--limit N] [--in-stock] [--brand X]
                                [--max-price N] [--min-rating N]
                                [--region CODE] [--device mobile|desktop]
                                [--no-category] [--explain]
shopping-graph parse "<query>"
shopping-graph classify "<text>" [--limit N]
shopping-graph taxonomy [<id|path>]
shopping-graph index [<file.json>]
```

## Notes & limitations

- The `LocalEmbedder` is a deterministic stand-in, not a neural model: semantics
  come from the curated concept map, not learned representations. Swap in a real
  `Embedder` for production-grade matching.
- The bundled taxonomy is a curated subset; load Google's full ~6,000-category
  file for complete coverage.
- Geo / co-purchase signals are supplied/seeded rather than learned from live logs.
