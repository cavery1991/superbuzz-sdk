# ShopGraph Web

The web UI for the shopping-graph engine — upload a client's product feed and see
what it will appear for on Google Shopping. Next.js (App Router) + Tailwind, light
"Stripe-clean" design. The engine runs server-side in API route handlers.

## Run

```bash
cd web
npm install        # installs Next + the parent engine (file: dependency)
npm run dev        # http://localhost:3000
```

Paste a hosted feed URL (e.g. a DataFeedWatch / Merchant Center XML link), upload
a feed file (XML / CSV / TSV / JSON), or click **Use sample feed**.

## Screens

- **Overview** — feed score, coverage, revenue opportunity, top opportunities.
- **Predict** — type any search term → which products would appear, and why.
- **Scan PDP** — paste a product page URL → inferred target searches + likelihood.
- **Products** — per-product feed health, price position, disapproval risk (drawer with fixes).
- **Opportunities** — every weakly/uncovered query, ranked.

## API

All server-side (Node runtime), thin wrappers over the engine in `lib/engine.js`:

- `POST /api/analyze` `{ feed | url, searchTerms? }` → full report (fetches `url` server-side)
- `POST /api/predict` `{ feed, query, threshold? }` → appearance verdicts
- `POST /api/scan`    `{ url }` or `{ html }` → PDP scan
- `GET  /api/sample`  → bundled sample feed + search terms

## Notes

- Uses the offline embedder by default (instant, no downloads). To use the real
  neural model, the engine supports it via `EMBEDDINGS_PROVIDER=neural`; wiring the
  async neural path into the routes is a follow-up.
- The engine is consumed as a `file:..` dependency and transpiled by Next; the
  optional `@huggingface/transformers` native dep is excluded from bundling.
