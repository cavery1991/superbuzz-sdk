# SuperBuzz SDK

Search query mining, PMax segmentation, and search term triage tools for Google Ads optimization.

## Quick Start (Web UI)

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Run the app
streamlit run app.py
```

The app opens at **http://localhost:8501**.

## How to Use

1. **Export data from Google Ads** — download a Search Terms report or Products report as CSV
2. **Upload the CSV** in the app
3. **Pick an analysis type** from the dropdown:
   - **Search Query Mining** — intent classification, profitability tiers, clusters, negative candidates, expansion opportunities
   - **Search Term Triage** — prioritized action queue (negate / isolate / leave / feed update / landing page gap)
   - **PMax Segmentation** — product segmentation into campaigns & asset groups by margin + performance
4. **Click "Run Analysis"**
5. **Download results** as CSV with the download buttons

## Required CSV Columns

Column names are flexible — the app auto-maps common Google Ads export names.

### Search Query Mining / Search Term Triage

| Column | Accepted names |
|--------|---------------|
| `search_term` | search term, query, search query |
| `impressions` | impressions, impr |
| `clicks` | clicks |
| `cost` | cost, spend |
| `conversions` | conversions, conv |
| `conversion_value` | conv. value, conversion value, revenue |

Optional: `match_type`, `campaign`, `ad_group`, `landing_page`

### PMax Segmentation

| Column | Accepted names |
|--------|---------------|
| `product_id` | product id, item id, sku |
| `impressions` | impressions, impr |
| `clicks` | clicks |
| `cost` | cost, spend |
| `conversions` | conversions, conv |
| `conversion_value` | conv. value, conversion value, revenue |

Optional: `title`, `category`, `brand`, `price`, `cost_of_goods` (or `gross_margin`)

## TypeScript SDK

The core analysis engine is also available as a TypeScript library:

```bash
npm install
npm run build
```

```typescript
import { SearchQueryMiner, SegmentationEngine, TriageEngine } from './src';
```

See the TypeScript source in `src/` for full API documentation.

## Tests

```bash
# TypeScript tests
npm test

# Python analysis module tests
python -m pytest tests/test_analysis.py -v
```
