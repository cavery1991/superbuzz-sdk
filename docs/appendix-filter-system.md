# Appendix: Global Filter System

*Supplement to the main project handover document. Covers the two filter dimensions that must run across every page, every API call, and every analysis engine in the app.*

---

## Why This Matters

This app exists to help DTC brands make better spend decisions. A blended "all channels, all customers" view is the default starting point -- but it hides the signal. The real decisions happen when a CMO asks:

- "Is Google Ads actually acquiring new customers, or just recapturing existing ones?"
- "What does Meta look like if I strip out returning customers?"
- "Show me non-brand performance on Google only -- new customers only."

Without these filters, the app is a reporting tool. With them, it becomes a decision system.

---

## The Two Filter Dimensions

### Filter 1: Platform

Controls *which advertising channel or data source* the user is looking at.

```
┌─────────────────────────────────────────────────────────┐
│  All Platforms  ▾                                        │
├─────────────────────────────────────────────────────────┤
│  All Platforms          ← default, aggregated view      │
│  Google Ads             ← Search + Shopping + PMax      │
│  Meta Ads               ← Facebook + Instagram          │
│  TikTok Ads             ← placeholder / future          │
│  Google Search Console  ← organic search data           │
│  Shopify                ← order-level data              │
└─────────────────────────────────────────────────────────┘
```

**When a specific platform is selected**, an optional sub-channel dropdown appears:

| Platform | Sub-channels |
|----------|-------------|
| Google Ads | Google Search, Google Shopping, Performance Max |
| Meta Ads | Prospecting / LAL, Retargeting |
| Shopify | Paid (UTM-attributed), Organic, Direct, Email, Referral |
| TikTok Ads | *(none yet)* |
| GSC | *(none)* |

**"All Platforms"** aggregates everything. This is the default. Every number shown is the sum across all connected sources.

### Filter 2: Customer Segment

Controls *which customer type* the metrics represent.

```
┌──────────────────────────────────────────┐
│  [ All Customers ]  [ New ]  [ Existing] │
└──────────────────────────────────────────┘
```

| Segment | What it means |
|---------|--------------|
| **All Customers** | Total metrics -- new + returning combined. Default view. |
| **New Customers** | Only first-time buyers. Revenue, conversions, CPA, ROAS -- all recalculated for new customers only. |
| **Existing Customers** | Only returning/repeat buyers. Same recalculation, opposite segment. |

---

## How Metrics Change Per Segment

This is the critical part. When the user switches segment, every derived metric on every page recalculates:

### "All Customers" (default)

| Metric | Calculation |
|--------|------------|
| Revenue | Total revenue from all orders |
| Conversions | Total conversion count (new + returning) |
| CPA | Total cost / total conversions |
| ROAS | Total revenue / total cost |
| MER | Total revenue (all sources) / total ad spend |
| New Customer % | new_customers / total_conversions |
| CVR | Total conversions / total clicks |

### "New Customers" selected

| Metric | Calculation |
|--------|------------|
| Revenue | Estimated new customer revenue (see estimation method below) |
| Conversions | `new_customers` field from DailyMetrics |
| CPA | Total cost / new_customers |
| ROAS | New customer revenue / total cost |
| MER | Total new customer revenue / total ad spend |
| New Customer % | 100% (by definition) |
| CVR | new_customers / total clicks |

### "Existing Customers" selected

| Metric | Calculation |
|--------|------------|
| Revenue | Estimated returning customer revenue |
| Conversions | `returning_customers` field from DailyMetrics |
| CPA | Total cost / returning_customers |
| ROAS | Returning customer revenue / total cost |
| MER | Total returning customer revenue / total ad spend |
| New Customer % | 0% (by definition) |
| CVR | returning_customers / total clicks |

### Revenue Estimation Method

The data model stores `revenue` as a single total per campaign per day. It does not split revenue by customer type at the daily metric level.

**Recommended approach (ratio-based estimation):**

```
new_customer_revenue = revenue * (new_customers / (new_customers + returning_customers))
returning_customer_revenue = revenue - new_customer_revenue
```

This is an approximation. It assumes new and returning customers have similar AOV within a campaign on a given day. For most DTC brands this is directionally accurate. The UI should show a small disclaimer: *"Revenue split estimated from customer count ratios."*

**More accurate alternative (when Shopify is connected):**

The `ShopifyOrder` table has a `new_customer` boolean on each order. When Shopify data is available, revenue can be split precisely at the order level and aggregated up. This should be preferred when the data exists.

---

## How Both Filters Combine

The two filters are independent and stack. Every query to the backend should pass both:

```
GET /api/v1/metrics/kpi-summary?platform=google_ads&customer_segment=new&start=2026-01-01&end=2026-03-31
```

This returns: KPI summary for Google Ads, new customers only, Q1 2026.

### Example Combinations

| Platform | Segment | What the user sees |
|----------|---------|-------------------|
| All | All | Full blended view (default) |
| All | New | New customer metrics across all channels |
| Google Ads | All | All Google Ads metrics, both customer types |
| Google Ads | New | Google Ads new customer acquisition only |
| Meta Ads | Existing | Meta retargeting / re-engagement performance |
| Google Ads > Search | New | Google Search new customer performance only |

### The Question Every Number Must Answer

> "This metric is for **[platform]** **[segment]** over **[date range]**."

If a user cannot immediately tell which platform and which customer segment a number represents, the filter implementation is incomplete.

---

## Page-by-Page Filter Impact

### Overview

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| KPI cards (Spend, Revenue, ROAS, MER, CPA, New %) | Scoped to selected platform's campaigns | Recalculated for selected segment |
| Revenue & Spend trend chart | Only selected platform's daily data | Revenue line reflects segment's share |
| Brand vs Non-brand donut | Split within selected platform only | Segment affects revenue attribution |
| Top Insights | Only insights relevant to selected platform | Insights reference selected segment |
| Top Recommendations | Actions relevant to selected platform | Recommendations adjust for segment |
| Health Indicators | Brand dependence calculated per-platform | Segment changes what "healthy" looks like |

### Brand vs Non-brand

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Spend / revenue split | Brand vs nonbrand within selected platform | Revenue split recalculated per segment |
| Performance comparison table | ROAS, CPA, CVR per platform | All metrics recalculated for segment |
| Search term classification | Terms from selected platform only | No direct effect (terms are pre-customer) |
| Trend charts | Time series scoped to platform | Revenue/conversion lines per segment |

**Key insight this enables:** "Non-brand on Google drives 56% of new customers but only 23% of returning customer revenue" -- this is invisible without the segment filter.

### Incrementality

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Observational comparison | Brand vs nonbrand within platform | Metrics per segment |
| Cannibalization estimate | Paid vs organic for selected platform | New customer cannibalization vs total |
| Spend-response curves | Curves fitted per platform | Curves fitted per segment |
| Marginal ROAS | Calculated per platform | Different by segment (nonbrand mROAS for new customers vs existing) |
| Experiment results | Experiments targeting selected platform | Lift broken down by segment |

**Key insight this enables:** "Brand spend cannibalization is 72% overall, but only 15% for new customers -- brand ads do help acquire first-time buyers, just not returning ones."

### Causation Lab

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Correlation matrix | Correlations computed from platform-specific data | Computed using segment-specific outcome variables |
| Variable pair analysis | All 5 causal checks scoped to platform | "Does nonbrand spend cause new customer growth?" vs "Does it cause total revenue?" |
| Causal confidence scores | Recalculated per platform (different data, different verdict) | Recalculated per segment |

**Key insight this enables:** "Google nonbrand spend has HIGH causal confidence for new customer growth, but only MEDIUM for total revenue" -- the causal story changes by segment.

### Pattern Memory

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Current state panel | Reflects selected platform's current spend/traffic | No direct effect on state definition |
| Similar states | Historical matching uses platform-specific metrics | Outcome summaries show segment averages |
| Outcome summary | Avg revenue, CVR, marginal return for platform | "In similar conditions, new customer CVR was X%" |
| Pattern insights | Platform-specific: "Google Search performed Y in this context" | "New customer acquisition was Z in similar conditions" |

### Recommendations

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Recommendation cards | Platform-specific actions: "Reduce Google brand spend" vs "Increase Meta prospecting" | Segment-aware rationale: "...because new customer CPA on Google brand is 3x higher than Meta" |
| Cross-platform actions | Only when "All Platforms" is selected | "Shift budget from Google brand to Meta prospecting for better new customer efficiency" |
| Confidence scores | Different per platform (data quality varies) | Different per segment (smaller sample = lower confidence) |

### Experiments

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Experiment list | Filtered by which platform the experiment targets | No filter (show all experiments) |
| Results | Results scoped to experiment's platform | Lift broken down: "Total lift: 12%. New customer lift: 18%. Existing customer lift: 4%." |
| Design form | Platform selection as part of experiment setup | Optional segment targeting in config |

### Scenario Simulator

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Input sliders | "Change Google Ads brand spend by X%" (platform-specific) | No input change, but output changes |
| Projected results | Projections based on platform-specific response curves | Shows segment breakdown: "New customers: +15%. Existing: -2%." |
| Historical analogues | Matched from platform-specific history | Analogue outcomes split by segment |
| Warnings | Platform-specific: "Limited Google Shopping history for this scenario" | Segment-specific: "Insufficient new customer data for high confidence" |

### Admin

| Element | Platform filter effect | Customer segment effect |
|---------|----------------------|------------------------|
| Brand keywords | Cross-platform (no filter) | No effect |
| Classification rules | Cross-platform (no filter) | No effect |
| Coverage stats | Filterable by platform: "83% classified for Google, 67% for Meta" | No effect |
| Contextual data | Cross-platform (no filter) | No effect |

---

## What Exists Today vs What Needs Building

### Currently Built

| Capability | Status |
|-----------|--------|
| Date range filter (7D, 30D, 90D, YTD, 1Y, All) | Working on Overview and Brand/Non-brand pages |
| `Campaign.channel` field in data model | Exists |
| `Campaign.data_source_id` FK in data model | Exists |
| `DailyMetrics.new_customers` field | Exists |
| `DailyMetrics.returning_customers` field | Exists |
| `ShopifyOrder.new_customer` boolean | Exists |
| Backend `channel` param on campaigns endpoint | Exists |

### Not Yet Built

| Capability | What's needed |
|-----------|--------------|
| Platform filter UI component | New `PlatformFilter` dropdown component |
| Customer segment toggle UI | New `CustomerSegmentToggle` three-button component |
| Global filter context | New React context wrapping the app, persisting filter state across pages |
| Backend platform param on all metric endpoints | Add `platform` query param to ~15 endpoints |
| Backend segment param on all metric endpoints | Add `customer_segment` query param to ~15 endpoints |
| Revenue estimation logic | Backend service function to split revenue by customer type |
| Engine filter pass-through | All 7 engines need platform + segment parameters |
| Filter bar in page header | Update `Header` and `PageLayout` components |
| Empty states for filtered views | Graceful handling when filter combo returns no data |

---

## API Contract

Every metric endpoint should accept these query parameters:

```
?platform=all                     # default
?platform=google_ads
?platform=meta_ads
?platform=tiktok_ads
?platform=gsc
?platform=shopify

?channel=google_search            # optional, only when platform is set
?channel=google_shopping
?channel=google_pmax
?channel=meta_prospecting
?channel=meta_retargeting

?customer_segment=all             # default
?customer_segment=new
?customer_segment=existing

?start=2026-01-01                 # existing date range
?end=2026-03-31
```

Backend implementation: filter by joining `DailyMetrics` to `Campaign` where `Campaign.channel` or `DataSource.source_type` matches the platform param. For customer segment, adjust the returned metrics using the ratio-based revenue estimation or Shopify order-level data.

---

## Edge Cases and Warnings

### Small Sample Sizes
When filtering to a specific platform + new customers only, sample sizes shrink. The UI should:
- Show sample size alongside metrics
- Reduce confidence levels automatically when n < 30 days
- Display a warning: "Based on limited data (X days). Interpret with caution."

### Platforms with No Customer Split
Some data sources (e.g., Google Search Console) don't have customer-level data. When customer segment filter is active:
- Show metrics that are available (traffic, impressions)
- Grey out or hide metrics that require customer data (CPA, ROAS per segment)
- Display: "Customer segmentation not available for this data source"

### Cross-Platform Revenue Attribution
When viewing "All Platforms" with a customer segment filter, revenue attribution across platforms may overlap (same customer, multiple touchpoints). The UI should note: "Revenue is attributed per-platform and may overlap in the All view."

### Zero-Division Protection
When a segment has zero customers (e.g., no new customers on a slow day), CPA and CVR become undefined. Show "--" or "N/A" rather than Infinity or NaN.

---

## Summary for Developers Picking This Up

1. **Two filters, always present**: Platform (dropdown) and Customer Segment (toggle). Both appear on every page.
2. **Three things always active**: Platform + Segment + Date Range. Every API call passes all three.
3. **Global state**: Use React context. Filters persist across page navigation.
4. **Backend changes**: Add `platform` and `customer_segment` params to every endpoint that returns metrics.
5. **Revenue split**: Use ratio-based estimation from `new_customers` / `returning_customers` counts. Upgrade to Shopify order-level data when available.
6. **Engines**: Every analysis engine (classification, incrementality, causation, patterns, insights, recommendations, simulator) must accept and respect both filter dimensions.
7. **Edge cases**: Handle small samples, missing data, zero-division, and cross-platform overlap gracefully.
8. **Reference**: See `docs/filtering-specification.md` for the full technical spec with implementation phases.
