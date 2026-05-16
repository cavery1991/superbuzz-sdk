# Filtering Specification: Platform & Customer Segmentation

## Overview

Every data view, chart, metric card, insight, recommendation, and analysis module in the app must be filterable by two dimensions:

1. **Platform** -- which advertising channel or data source
2. **Customer Segment** -- all customers, new customers only, or existing (returning) customers only

These filters must be persistent across page navigation, available on every page, and reflected in every API call. No module is exempt.

---

## Filter Dimension 1: Platform

### Filter Options

| Filter Value | What It Includes |
|-------------|-----------------|
| **All Platforms** (default) | Aggregated view across every connected source |
| **Google Ads** | Google Search, Google Shopping, Performance Max |
| **Meta Ads** | Facebook + Instagram (prospecting, retargeting) |
| **TikTok Ads** | TikTok campaign data |
| **Google Search Console** | Organic search visibility data |
| **Shopify** | Order and revenue data (direct, organic, referral) |

### Sub-channel Filtering (Level 2)

When a platform is selected, an optional second-level filter should expose channel-specific breakdowns:

**Google Ads sub-channels:**
- Google Search (brand, nonbrand, competitor)
- Google Shopping (brand, nonbrand)
- Performance Max

**Meta Ads sub-channels:**
- Prospecting / LAL
- Retargeting

**Shopify sub-channels:**
- Paid (attributed via UTM)
- Organic
- Direct
- Email
- Referral

### Where Platform Filter Applies

| Page | How Platform Filter Affects It |
|------|-------------------------------|
| **Overview** | KPI cards, trend charts, spend/revenue splits, insights, and recommendations all scoped to selected platform |
| **Brand vs Non-brand** | Classification split, search terms, spend/revenue comparison -- all scoped to selected platform |
| **Incrementality** | Observational metrics, proxy incrementality, spend-response curves -- all scoped to selected platform |
| **Causation Lab** | Correlation matrix and causal analysis run only on data from selected platform |
| **Pattern Memory** | Historical state matching uses only metrics from selected platform |
| **Recommendations** | Recommendations generated and displayed only for selected platform context |
| **Experiments** | Experiments filtered by which platform they target |
| **Scenario Simulator** | Simulation inputs and historical analogues scoped to selected platform |
| **Admin** | Classification rules and brand keywords apply cross-platform, but coverage stats should be platform-filterable |

### Current State vs Required

- **Backend**: The `Campaign` model has a `channel` field and `data_source_id` FK. The campaigns API accepts a `channel` query param. Most other endpoints (metrics, incrementality, causation, patterns, insights, recommendations) do **not** currently accept a platform/channel filter.
- **Frontend**: No platform filter UI exists. No API calls pass channel parameters.

### What Needs to Change

**Backend -- every endpoint that returns metric data must accept:**
```
?platform=all|google_ads|meta_ads|tiktok_ads|gsc|shopify
?channel=google_search|google_shopping|google_pmax|meta_prospecting|meta_retargeting  (optional)
```

These params filter the underlying `DailyMetrics` join to `Campaign` records matching the specified platform/channel.

**Frontend -- a global `PlatformFilter` component must:**
- Appear in the app header or page header on every page
- Store selection in shared state (React context or URL params)
- Pass the selected platform to every API call
- Update all displayed data when changed

---

## Filter Dimension 2: Customer Segment

### Filter Options

| Filter Value | What It Includes |
|-------------|-----------------|
| **All Customers** (default) | Total conversions, revenue, orders -- new + returning combined |
| **New Customers Only** | Only metrics attributable to first-time buyers |
| **Existing Customers Only** | Only metrics attributable to returning/repeat buyers |

### How Customer Segment Filter Affects Metrics

When "New Customers Only" is selected:

| Metric | Behaviour |
|--------|-----------|
| **Revenue** | Revenue attributed to new customer orders only |
| **Conversions** | New customer conversion count only |
| **Orders** | New customer order count only |
| **CPA** | Cost / new customer conversions |
| **ROAS** | New customer revenue / cost |
| **MER** | Total new customer revenue / total spend |
| **New Customer %** | Always 100% (by definition) |
| **CVR** | New customer conversions / clicks |
| **COGS / Margin** | Pro-rated based on new customer share of revenue |
| **AOV** | New customer revenue / new customer orders |

When "Existing Customers Only" is selected: same logic, using returning customer counts and revenue.

### Data Model Implications

The `DailyMetrics` table currently has:
- `new_customers` (integer count)
- `returning_customers` (integer count)
- `revenue` (total, not split by customer type)

**Gap**: Revenue is not split by new vs returning at the daily metrics level.

**Required changes -- choose one approach:**

**Option A (recommended): Estimate from ratios**
- New customer revenue = `revenue * (new_customers / (new_customers + returning_customers))`
- Returning customer revenue = `revenue - new_customer_revenue`
- Simple, works with existing data, good enough for directional decisions
- Document assumption clearly in UI

**Option B: Add fields to DailyMetrics**
- Add `new_customer_revenue` and `returning_customer_revenue` columns
- Requires data source updates to populate
- More accurate but requires migration

**Option C: Derive from ShopifyOrder table**
- `ShopifyOrder` has `new_customer` boolean and per-order `revenue`
- Aggregate from order-level data when Shopify is connected
- Most accurate but only works for Shopify source

### Where Customer Segment Filter Applies

| Page | How Customer Segment Filter Affects It |
|------|---------------------------------------|
| **Overview** | All KPI cards recalculate for selected segment. Trend charts show segment-specific revenue/conversions. Insights regenerate for segment. |
| **Brand vs Non-brand** | Brand vs nonbrand comparison shows segment-specific ROAS, CPA, CVR, revenue. Key question: "Is non-brand actually driving NEW customers or just retargeting existing ones?" |
| **Incrementality** | Observational metrics scoped to segment. Proxy incrementality recalculates -- brand cannibalization matters most for new customers. Marginal ROAS per segment. |
| **Causation Lab** | Correlations and causal analysis can be run on segment-specific metrics (e.g., "Does non-brand spend cause new customer growth?") |
| **Pattern Memory** | Historical pattern outcomes filtered by segment. "In similar conditions, what happened to new customer acquisition?" |
| **Recommendations** | Recommendations weighted by segment impact. "Reducing brand spend has low impact on new customers but may affect returning customer re-engagement." |
| **Experiments** | Experiment results broken down by segment. "The holdout test showed 12% total revenue drop but only 3% new customer revenue drop." |
| **Scenario Simulator** | Projected outcomes show segment-specific estimates. "Shifting spend to non-brand is projected to increase new customers by 18% but reduce returning customer revenue by 5%." |
| **Admin** | No direct impact -- admin manages rules, not metric views |

### What Needs to Change

**Backend -- every metric endpoint must accept:**
```
?customer_segment=all|new|existing
```

When `new` is selected, the endpoint filters/adjusts metrics to reflect new customer activity only. When `existing` is selected, returning customer activity only.

**Frontend -- a global `CustomerSegmentFilter` component must:**
- Appear alongside the platform filter on every page
- Three-option toggle: All | New | Existing
- Pass selection to every API call
- Trigger data refresh on change

---

## Combined Filter Behaviour

Both filters work together. A user should be able to ask:

> "Show me Google Ads performance for new customers only over the last 90 days"

This means:
- Platform = Google Ads
- Customer Segment = New Customers
- Date Range = 90 days

Every chart, card, insight, and recommendation on every page should respect all three filters simultaneously.

### Filter State Management

Filters should be managed in a global React context so they persist across page navigation:

```
GlobalFilters {
  platform: 'all' | 'google_ads' | 'meta_ads' | 'tiktok_ads' | 'gsc' | 'shopify'
  channel: string | null  // sub-channel, optional
  customerSegment: 'all' | 'new' | 'existing'
  dateRange: { start: string, end: string }
}
```

Every API call function should accept these filters and append them as query parameters.

---

## Filter UI Specification

### Placement

The filter bar sits in the page header area, above page content, below the page title. It contains:

```
[ Platform Dropdown ▾ ]  [ Sub-channel Dropdown ▾ ]  [ All | New | Existing ]  [ Date Range Presets ]
```

### Behaviour

- **Platform dropdown**: Single-select. Default "All Platforms". When changed, sub-channel dropdown populates with relevant options (or hides if "All").
- **Customer segment toggle**: Three-button toggle group. Default "All Customers". Visually distinct active state.
- **Date range**: Existing preset picker (7D, 30D, 90D, YTD, 1Y, All).
- All filters update data immediately on change (no "Apply" button needed).
- Active non-default filters should show a visual indicator (highlighted state, badge, or count).

### Empty and Insufficient Data States

When a filter combination returns no data:
- Show a clear empty state: "No data available for [Platform] / [Segment] in this date range"
- Do not show zero-value charts or misleading flat lines
- Insights and recommendations should note when they lack sufficient data for a segment

---

## Impact on Analysis Engines

### Classification Engine
- No change needed -- classification is term-level, not segment-specific
- Coverage stats in Admin should be filterable by platform

### Incrementality Engine
- `observational_analysis()` must accept platform + segment params
- `proxy_incrementality()` must scope paid-vs-organic comparison to selected platform
- Brand dependence score should be calculable per-platform
- Experiment results should break down by customer segment

### Causation Engine
- `full_causal_analysis()` must accept platform filter to scope the data window
- Customer segment filter should allow questions like "Is non-brand spend causal for new customer growth specifically?"
- Correlations should be re-computable per platform and per segment

### Pattern Memory Engine
- `find_similar_states()` must accept platform filter
- Outcome summaries should show segment-specific averages when filtered
- Pattern insights should reference the active segment: "In similar conditions, new customer acquisition increased by..."

### Insight Generation
- `generate_insights()` must accept platform + segment
- Insights should be tagged with which platform/segment they apply to
- Platform-specific insights: "Google Ads brand spend increased but Meta prospecting stayed flat"
- Segment-specific insights: "New customer CPA increased 25% while existing customer CPA held steady"

### Recommendation Engine
- `generate_recommendations()` must be platform-aware
- Recommendations should differ by segment: "Reduce Google Ads brand spend" vs "Increase Meta prospecting budget for new customer acquisition"
- Cross-platform recommendations when viewing All: "Shift 15% of Google brand budget to Meta prospecting for better new customer efficiency"

### Scenario Simulator
- Simulation inputs should be platform-scoped: "Reduce Google Ads brand spend by 20%"
- Projected outcomes should show segment breakdown: "New customers: +12%, Existing customers: -3%"
- Historical analogues should match on platform-specific patterns

---

## Implementation Priority

### Phase 1: Platform Filter (Backend + Frontend)
1. Add `platform` and `channel` query params to all metric endpoints
2. Build `PlatformFilter` dropdown component
3. Create global filter context
4. Wire all API calls through filter context
5. Test every page with platform filtering

### Phase 2: Customer Segment Filter (Backend + Frontend)
1. Implement revenue estimation logic (Option A: ratio-based)
2. Add `customer_segment` query param to all metric endpoints
3. Build `CustomerSegmentToggle` component
4. Wire segment into all API calls and page displays
5. Update insight and recommendation engines to be segment-aware

### Phase 3: Cross-cutting Concerns
1. Update analysis engines to accept both filters
2. Regenerate insights and recommendations per platform + segment
3. Add segment breakdown to experiment results
4. Update scenario simulator for platform-specific inputs
5. Add filter indicators and empty states throughout

---

## Key Principle

Every number the user sees must be answerable with: "This is for [platform] [segment] over [date range]." If a user cannot tell which platform or customer segment a metric refers to, the filter implementation is incomplete.
