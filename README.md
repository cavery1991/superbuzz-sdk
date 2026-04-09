# SuperBuzz PPC Analytics

A production-ready decision-support system for eCommerce PPC agencies. Not a dashboard -- a smart analyst with memory that helps clients understand brand vs non-brand performance, incrementality, correlation vs causation, and what to do next based on historical patterns.

## What This App Does

It answers five questions for every data point:

1. **What is happening?** -- KPI trends, brand vs non-brand splits, campaign performance
2. **What is likely driving it?** -- Causal analysis, not just correlation
3. **Is it probably causal or just correlated?** -- Multi-factor causality scoring
4. **What happened in similar situations before?** -- Pattern memory with weighted similarity matching
5. **What should we do next?** -- Confidence-scored recommendations with evidence

## Architecture

```
superbuzz-sdk/
├── backend/                    # Python FastAPI
│   ├── app/
│   │   ├── main.py             # FastAPI app, startup, CORS, routing
│   │   ├── config.py           # Pydantic settings
│   │   ├── database.py         # SQLAlchemy engine + session
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── api/routes/         # API endpoint routers
│   │   ├── engines/            # Core analysis engines
│   │   │   ├── classification.py   # Brand vs non-brand classification
│   │   │   ├── incrementality.py   # 3-level incrementality analysis
│   │   │   ├── causation.py        # Correlation vs causation engine
│   │   │   ├── patterns.py         # Contextual pattern memory
│   │   │   ├── insights.py         # Automated insight generation
│   │   │   ├── recommendations.py  # Action recommendation engine
│   │   │   └── simulator.py        # Scenario simulation
│   │   ├── services/           # Data ingestion connectors
│   │   └── seed/               # Demo data seeding
│   └── tests/                  # Pytest test suite
├── frontend/                   # React + TypeScript + Vite
│   ├── src/
│   │   ├── pages/              # 9 main pages
│   │   ├── components/         # Reusable UI components
│   │   ├── services/           # API client
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript interfaces
│   │   └── utils/              # Formatting utilities
│   └── ...
├── .env.example                # Environment variable template
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, SQLAlchemy, Pydantic v2 |
| Database | SQLite (dev), PostgreSQL-ready |
| Analysis | NumPy, SciPy, Pandas |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Charts | Recharts |
| Icons | Lucide React |

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- npm

### Backend Setup

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Copy environment config
cp ../.env.example ../.env

# Start the server (auto-seeds demo data on first run)
uvicorn app.main:app --reload --port 8000
```

The backend starts at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

Demo data is seeded automatically on first startup -- 90 days of campaign metrics, search terms, organic data, Shopify orders, contextual data, insights, and recommendations for a fictional brand.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (proxies API to backend)
npm run dev
```

The frontend starts at `http://localhost:3000`.

### Run Tests

```bash
cd backend
python -m pytest tests/ -v
```

## Core Modules

### 1. Brand vs Non-brand Classification

Classifies search terms into brand, non-brand, competitor, or unknown using:
- **Exact match** against brand keyword lists
- **Contains match** for partial brand mentions
- **Regex rules** for pattern-based classification (e.g., competitor names)
- **Priority ordering** -- higher priority rules win on conflicts
- **Admin UI** for managing rules and reviewing uncertain cases

### 2. Incrementality Analysis (3 Levels)

**Level 1 -- Observational:**
Compares brand vs non-brand on spend, revenue, CPA, ROAS, MER, contribution margin, and new customer mix. Shows trend over time.

**Level 2 -- Proxy Incrementality:**
- Estimates cannibalization between paid brand and organic brand traffic
- Builds spend-response curves using logarithmic regression
- Calculates marginal ROAS at current spend levels
- Identifies diminishing returns thresholds
- Computes brand dependence score

**Level 3 -- Experiment Support:**
- Geo holdout and time-based holdout experiment design
- Treatment vs control comparison
- Lift calculation with confidence intervals (scipy.stats)
- Statistical significance testing

### 3. Correlation vs Causation Engine

Every relationship is scored across 5 dimensions:

| Check | What it measures |
|-------|-----------------|
| **Correlation** | Pearson + Spearman rank correlation strength |
| **Temporal Precedence** | Does the cause precede the effect? Tests at 1, 3, 7 day lags |
| **Isolation** | How many other variables changed simultaneously? |
| **Saturation** | Is there diminishing returns (log curve fit)? |
| **Demand Dependency** | Does revenue follow spend or underlying organic demand? |

**Confidence scoring:**
- Weighted composite (correlation: 25%, temporal: 20%, isolation: 20%, saturation: 15%, demand: 20%)
- Composite >= 0.65 = **High confidence** -- likely causal
- Composite >= 0.40 = **Medium confidence** -- plausible but unproven
- Composite < 0.40 = **Low confidence** -- correlation only or confounded

Every verdict includes a human-readable explanation of why the score was assigned.

### 4. Contextual Pattern Memory

Defines a "state" as a combination of:
- Day of week, month, season
- Temperature band (cold/mild/warm/hot)
- Spend band (low/medium/high/very high -- quartiles)
- Promo status, brand spend percentage, traffic level

**Similarity matching:**
Uses weighted distance across all state dimensions. Default weights: month (0.20), day of week (0.15), season (0.15), spend band (0.15), temperature (0.10), promo (0.10), brand split (0.10), traffic (0.05).

Retrieves top-N similar historical days, summarizes their outcomes (revenue, CVR, new customers, marginal return), and computes:
- **Consistency score** -- how similar were outcomes across matches
- **Pattern strength** -- strong/moderate/weak/none
- **Decision summary** -- human-readable insight like "In similar conditions, increasing spend beyond X reduced marginal return"

### 5. Insight Generation

Every insight follows this structure:
1. What changed
2. What happened next
3. Interpretation
4. Confidence level (high/medium/low)
5. Recommended action

Covers: brand efficiency, non-brand growth, cannibalization warnings, diminishing returns, seasonality, weather patterns, promo effectiveness, new customer trends.

### 6. Recommendations Engine

Generates actionable recommendations:
- Reduce brand spend (high cannibalization)
- Reallocate to non-brand (better marginal ROAS)
- Hold spend flat (high uncertainty)
- Run holdout test (low causal confidence)
- Investigate weather-sensitive categories
- Scale within safe efficiency ranges

Each includes: rationale, expected effect, confidence, risks, supporting evidence.

### 7. Scenario Simulator

Interactive what-if analysis:
- Input: brand spend change %, non-brand spend change %, promo toggle, context overrides
- Uses spend-response curves + historical pattern matching
- Outputs: projected revenue range (p25/p50/p75), ROAS, new customers
- Shows historical analogues, warnings, and assumptions

## Data Model

### Primary Tables
- **DataSource** -- Google Ads, GA4, Shopify, Meta Ads, etc.
- **Campaign** -- Campaign details with brand/nonbrand/competitor classification
- **DailyMetrics** -- Daily campaign metrics (impressions, clicks, cost, conversions, revenue, new customers, COGS, margin)
- **SearchTerm** -- Search term level data with classification
- **OrganicMetrics** -- GA4/GSC organic traffic and revenue
- **ShopifyOrder** -- Order-level data with UTM tracking
- **ContextualData** -- Daily context (weather, day of week, season, promo status)
- **BrandKeyword** -- Brand keyword list for classification
- **ClassificationRule** -- Configurable classification rules
- **Experiment** -- Holdout/budget shift experiments
- **Insight** -- Generated insights with evidence
- **Recommendation** -- Actionable recommendations with status tracking

## UI Pages

| Page | Purpose |
|------|---------|
| **Overview** | Executive KPIs, top insights, brand/nonbrand split, recommendations, health indicators |
| **Brand vs Non-brand** | Deep comparison, classification coverage, search term analysis |
| **Incrementality** | 3-tab analysis: observational, proxy, experiments |
| **Causation Lab** | Correlation matrix, variable pair analysis with 5-check scoring |
| **Pattern Memory** | Context query builder, similar state retrieval, outcome summary |
| **Recommendations** | Filterable recommendation cards with accept/reject |
| **Experiments** | Experiment management, design, and results |
| **Scenario Simulator** | Interactive spend change simulation |
| **Admin** | Brand keywords, classification rules, contextual data, weights |

## API Endpoints

All endpoints under `/api/v1`:

| Group | Endpoints |
|-------|-----------|
| Campaigns | `GET /campaigns`, `GET /campaigns/{id}`, `GET /campaigns/{id}/metrics`, `GET /campaigns/summary` |
| Metrics | `GET /metrics/daily`, `GET /metrics/brand-vs-nonbrand`, `GET /metrics/kpi-summary` |
| Search Terms | `GET /search-terms`, `GET /search-terms/coverage`, `POST /search-terms/reclassify` |
| Incrementality | `GET /incrementality/observational`, `GET /incrementality/proxy`, `GET|POST /incrementality/experiments` |
| Causation | `GET /causation/correlations`, `GET /causation/analysis`, `GET /causation/confounders` |
| Patterns | `POST /patterns/similar`, `GET /patterns/query`, `GET /patterns/states` |
| Insights | `GET /insights`, `POST /insights/generate`, `PATCH /insights/{id}/dismiss` |
| Recommendations | `GET /recommendations`, `POST /recommendations/generate`, `PATCH /recommendations/{id}/status` |
| Simulator | `POST /simulator/scenario` |
| Admin | Brand keywords CRUD, classification rules CRUD, contextual data |

## Demo Data

The app seeds 90 days of realistic data for a fictional eCommerce brand with:

- **10 campaigns** across Google Ads (search, shopping, PMax) and Meta Ads
- **Brand cannibalization** -- high brand ROAS but organic traffic drops when brand spend increases
- **Non-brand incrementality** -- lower ROAS but genuinely drives new customers
- **Seasonality** -- holiday bumps, seasonal demand patterns
- **Promo periods** -- Spring Sale and Summer Blitz with 2x conversion but lower margins
- **Weather effects** -- outdoor gear converts better in warm weather
- **Misleading correlations** -- temperature and revenue correlate but it's seasonality, not causal

## Connecting Real Data Sources

Replace the mock connectors in `backend/app/services/data_ingestion.py`:

1. **Google Ads**: Use `google-ads` Python client. Set credentials in `.env`.
2. **GA4**: Use `google-analytics-data` Python client. Set property ID and credentials.
3. **Shopify**: Use Shopify Admin API. Set store URL and access token.
4. **Meta Ads**: Use Facebook Business SDK. Set access token and ad account ID.
5. **Weather**: Use OpenWeatherMap or similar. Set API key.

Each connector has a placeholder class with the expected interface. Implement the `fetch_*` methods and call `normalize_to_daily_metrics()` to ingest into the unified model.

## Design Principles

- **Not a dashboard** -- every page helps make a budget, bidding, or allocation decision
- **No fake certainty** -- confidence levels, assumptions, and limitations shown everywhere
- **Explainable** -- every score traces back to inputs, logic, and assumptions
- **Commercially literate** -- outputs speak the language of founders and CMOs
- **Pattern-aware** -- uses historical context to inform decisions, not just trends
- **Incrementality-first** -- distinguishes genuine growth from captured demand
