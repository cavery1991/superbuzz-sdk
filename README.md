# Shopping Graph

A **Google Shopping feed analysis & optimization tool**, built on a self-contained
simulation of how Google Shopping matches queries to products: the Google Product
Category taxonomy ("the number system"), semantic vector embeddings with cosine
similarity, a Shopping Graph product store, query factor extraction, multi-source
product profiles, and real-time contextual re-ranking.

The headline use case (`analyze`) takes a merchant's product feed — and optionally
their real Google Ads Search Terms report — and produces a single report covering:
**coverage** (what the catalog matches today), **gaps/opportunities** (high-value
queries it misses), **per-product feed fixes**, and the **simulated lift** each fix
would deliver. The semantic engine acts as a "Google's brain" simulator, so it
works with zero Google account access and gets sharper when real query data is fed in.

It runs entirely offline (no API keys) and ships with a CLI, a test suite, and
sample data. The embedding provider is pluggable, so a real model
(Vertex AI / MUM / BERT-style) can be swapped in without touching callers.

```bash
node bin/cli.js predict "waterproof hiking boots"  # ← would each product appear, and why?
node bin/cli.js predict "warm winter coat" --product SKU-1001   # detailed single-product verdict
node bin/cli.js analyze data/feed.sample.json \
  --search-terms data/search-terms.sample.csv \
  --html feed-report.html                          # full report: coverage, gaps, fixes,
                                                    # lift, revenue $, price & disapproval risk
node bin/cli.js generate                           # LLM/template-rewritten optimized feed copy
node bin/cli.js compete data/competitors.sample.json   # share-of-voice + price position
node bin/cli.js channels meta                      # syndicate the feed to another channel
node bin/cli.js monitor                            # snapshot + regression alerts over time
node bin/cli.js eval                               # retrieval metrics + threshold calibration
node bin/cli.js validate                           # does coverage predict real performance?
node bin/cli.js demo                               # engine walkthrough
npm test                                           # 114 tests
```

## Appearance prediction (`predict`) — the core question

> *Given a client's product feed and a search term, would each product appear?*

`predict` is the direct answer. It mimics Google's match by combining three things
into a verdict per product:

1. **Relevance** — the product's vector vs the query vector (cosine), against a
   calibrated "appear" bar.
2. **Eligibility** — is it actually servable? In stock and not policy-disapproved.
   A perfectly relevant item that's out of stock or disapproved *never shows*, so
   eligibility gates the verdict.
3. **Fix path** — if it falls short, would applying the recommended feed changes
   push it over the bar?

Verdicts: **appears** (with rank + confidence), **borderline** (small fixes away,
with the exact terms to add), **absent** (not relevant), **ineligible** (relevant
but can't serve — with the reason). Example:

```
Appearance prediction — "waterproof hiking boots"
Inferred aisle: [3237] Apparel & Accessories > Shoes > Boots  ·  appear bar: 0.45
Verdict counts: 1 appear · 0 borderline · 4 absent · 1 ineligible

WOULD APPEAR (1):
  #1  SKU-1004  Waterproof Hiking Boots   rel 0.584  conf 83%
INELIGIBLE — relevant but can't serve (1):
  SKU-1001  Parka   (likely disapproved)
```

Library: `predictAppearance({ engine, query, ... })` / `predictForProduct(args, id)`.
The "appear bar" is a threshold you calibrate against labeled data with the eval
harness (`calibrateThresholds`). This is a *simulation* of Google's matching, not
Google — treat the probability as directional.

## Capability map

| Capability | Module / command | What it adds |
|---|---|---|
| **Appearance prediction** | `predict/appearance` · `predict` | would a product appear for a term — verdict, confidence, why, fix path |
| Feed audit + coverage/gap + simulated lift | `feed/analyzer` · `analyze` | the core report |
| **LLM feed copywriting** (closes the loop) | `generate/feed-generator` · `generate` | rewrites titles/descriptions (LLM or offline template) to fill the gaps |
| **Price competitiveness** | `pricing/price-intel` | flags items priced above market (a major ranking factor) |
| **Revenue attribution** | `revenue/attribution` | projects $ from fixes so the list is prioritized by money, not coverage |
| **Policy / disapproval risk** | `feed/compliance` | catches items that would be suppressed entirely |
| **Competitive intelligence** | `competitive/competitive` · `compete` | share-of-voice, price position, title gaps vs rivals |
| **Image audit** | `image/image-audit` | flags missing angles / low-res / no lifestyle shot (pluggable vision) |
| **Demand & seasonality** | `demand/trends` | weights the query universe toward rising/in-season demand |
| **Multi-channel syndication** | `channels/channels` · `channels` | export to Google / Meta / Amazon feed specs |
| **Continuous monitoring** | `monitor/monitor` · `monitor` | snapshot + diff + regression alerts |
| **Learned ranker** | `ranking/ranker` | logistic model blending semantic + price + quality + availability (CTR/convert seam) |
| **Real embeddings** | `embeddings/factory` | OpenAI-compatible provider, offline fallback |
| **Evaluation & validation** | `eval/evaluator` · `eval`/`validate` | precision/recall/NDCG, threshold calibration, performance back-test |

## The feed analysis tool (`analyze`)

```
node bin/cli.js analyze <feed.json> [--search-terms <report.csv>]
```

Pipeline (`src/feed/`):

1. **Ingest** (`feed-ingest.js`) — read the feed in the real Merchant Center /
   Content API spec (JSON or TSV), and optionally a Google Ads Search Terms CSV.
2. **Query universe** (`query-universe.js`) — the searches to evaluate against.
   Real Search Terms rows (weighted by conversions/clicks/impressions) merge with
   queries auto-generated from each category × the attributes/brands in the catalog,
   so the tool works with or without Google data.
3. **Audit** (`auditor.js`) — per-product feed score (0-100) flagging missing
   required/recommended attributes, weak titles, missing/incorrect GPC, and
   review/image signals not surfaced in the text.
4. **Optimize** (`optimizer.js`) — concrete, ranked recommendations and an
   *optimized representation* (enriched title + corrected GPC + folded-in
   attributes and review signals).
5. **Analyze + simulate** (`analyzer.js`) — score coverage **before vs. after**
   applying every recommendation, and report the lift.

The differentiator is step 5: rather than just listing feed-hygiene issues like
most tools, it **simulates the relevance impact** — "surfacing your boots' 'didn't
slip on ice' reviews and adding the GPC would newly cover *waterproof boot*,
*durable boot*, and *insulated down parka*." Coverage (queries matched above
threshold), not raw cosine, is the headline metric, because adding terms to a
normalized vector can lower peak similarity even while it matches *more* queries.

### What feeds the simulation
The engine indexes the feed and scores each universe query against each product
with cosine similarity. The "after" representation is a strict superset of the
current product text, so the simulated lift only ever reflects information *added*
(attributes, category, surfaced reviews), never content removed.

> **Real-data note:** the feed and the Search Terms CSV are real inputs. The
> *which-queries-you-rank-for* signal is only fully accurate from Google's own
> data (Search Terms report / Content API). Without it, the generated query
> universe is an estimate — useful for direction, not a substitute for the report.

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

### Real embedding models (pluggable)
`src/embeddings/factory.js`, `remote-embedder.js`

The offline `LocalEmbedder` is the default, but a real model drops in behind the
same `Embedder` interface. `createEmbedder()` selects the provider from env:

```bash
EMBEDDINGS_PROVIDER=remote \
EMBEDDINGS_API_URL=https://api.openai.com/v1/embeddings \
EMBEDDINGS_API_KEY=sk-... \
EMBEDDINGS_MODEL=text-embedding-3-small
```

`RemoteEmbedder` targets any OpenAI-compatible endpoint (OpenAI, Vertex's
compatible layer, Voyage, or a self-hosted bge/e5 server). Because HTTP is async
but the engine embeds synchronously, vectors are fetched in batches and cached
via `warm()`; use `createShoppingSystemAsync()` and the engine's `indexAllAsync` /
`searchAsync` methods. With no key configured it degrades gracefully to the local
embedder. `fetchImpl` is injectable, so it's fully testable without a network.

### Validation & evaluation
`src/eval/evaluator.js`

Turns "is it any good?" into measurement (`node bin/cli.js eval` / `validate`):

- **`evaluate()`** — precision/recall/MRR/NDCG@k against labeled
  `query → relevant-product` judgments (`data/relevance.sample.json`).
- **`calibrateThresholds()`** — sweeps the cosine cutoff against those labels to
  recommend data-driven `well`/`weak` coverage thresholds instead of constants.
  (It already flagged that the analyzer's default `well: 0.45` is stricter than
  the labeled data supports.)
- **`validateAgainstPerformance()`** — the back-test: bucket real Search Terms by
  predicted coverage and check whether better-covered queries actually earned more
  (clicks/conversions). If "well" queries don't out-earn "gap" queries, the
  coverage signal isn't predictive — and the harness tells you so.

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
  feed/          analyzeFeed     — the merchant feed-optimization tool:
                   feed-ingest · query-universe · auditor · optimizer · analyzer
  report/        renderHtmlReport — standalone HTML report for the analysis
  eval/          evaluate · calibrateThresholds · validateAgainstPerformance
  index.js       createShoppingSystem(...) / createShoppingSystemAsync(...) + exports
bin/cli.js       analyze / eval / validate / demo / search / parse / classify / taxonomy / index
data/            catalogs, sample feed, search-terms CSV, relevance judgments
test/            node:test suites for every module (59 tests)
```

## CLI reference

```
shopping-graph analyze [<feed.json>] [--search-terms <terms.csv>]
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
