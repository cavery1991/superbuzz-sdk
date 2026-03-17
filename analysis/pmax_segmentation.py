"""PMax Segmentation Recommender: margin tiers, performance scoring, campaign structure."""

import pandas as pd
from .shared import calc_metrics


def calc_margin(row):
    if "gross_margin" in row and pd.notna(row.get("gross_margin")):
        return row["gross_margin"]
    if "cost_of_goods" in row and pd.notna(row.get("cost_of_goods")) and row.get("price", 0) > 0:
        return ((row["price"] - row["cost_of_goods"]) / row["price"]) * 100
    return 0


def margin_tier(margin_pct, high=50, mid=25):
    if margin_pct >= high:
        return "high-margin"
    if margin_pct >= mid:
        return "mid-margin"
    if margin_pct > 0:
        return "low-margin"
    return "negative-margin"


def performance_tier(row, hero_conv=10, hero_roas=4.0, min_clicks=20,
                     underperformer_roas=1.0, zombie_impressions=50):
    m = calc_metrics(row)
    if row["impressions"] < zombie_impressions:
        return "zombie"
    if row["clicks"] < min_clicks:
        return "new"
    if row["conversions"] >= hero_conv and m["roas"] >= hero_roas:
        return "hero"
    if m["roas"] < underperformer_roas:
        return "underperformer"
    return "solid"


def suggest_bid_strategy(margin_tier_val, perf_tier, avg_margin):
    if perf_tier == "hero":
        troas = max(100 / avg_margin * 1.2, 2.0) if avg_margin > 0 else 3.0
        return f"Max conv. value (tROAS {troas:.1f})"
    if perf_tier in ("zombie", "new"):
        return "Max clicks (discovery)"
    if perf_tier == "underperformer":
        troas = (100 / avg_margin * 2) if avg_margin > 0 else 8.0
        return f"Max conv. value (high tROAS {troas:.1f})"
    troas = (100 / avg_margin * 1.5) if avg_margin > 0 else 4.0
    return f"Max conv. value (tROAS {troas:.1f})"


def run(df):
    """Run PMax segmentation. Returns dict of DataFrames."""
    df = df.copy()
    df["margin_pct"] = df.apply(calc_margin, axis=1).round(1)
    df["margin_tier"] = df["margin_pct"].apply(margin_tier)
    df["perf_tier"] = df.apply(performance_tier, axis=1)
    df["break_even_roas"] = df["margin_pct"].apply(
        lambda m: round(100 / m, 2) if m > 0 else float("inf")
    )

    m = df.apply(lambda r: pd.Series(calc_metrics(r)), axis=1)
    df["roas"] = m["roas"].round(2)

    # Build asset group recommendations
    groups = []
    for (mt, pt), g in df.groupby(["margin_tier", "perf_tier"]):
        cats = g["category"].unique() if "category" in g.columns else ["All"]
        for cat in cats:
            subset = g[g["category"] == cat] if "category" in g.columns else g
            avg_margin = subset["margin_pct"].mean()
            groups.append({
                "campaign": f"PMax - {mt}",
                "asset_group": f"{mt} | {pt} | {cat}",
                "products": len(subset),
                "avg_margin": round(avg_margin, 1),
                "avg_roas": round(subset["roas"].mean(), 2),
                "total_spend": round(subset["cost"].sum(), 2),
                "total_revenue": round(subset["conversion_value"].sum(), 2),
                "bid_strategy": suggest_bid_strategy(mt, pt, avg_margin),
            })

    asset_groups = pd.DataFrame(groups)

    # Insights
    insights_list = []
    heroes = df[df["perf_tier"] == "hero"]
    zombies = df[df["perf_tier"] == "zombie"]
    underperformers = df[df["perf_tier"] == "underperformer"]

    if len(heroes):
        insights_list.append({
            "insight": f'{len(heroes)} hero products driving ${heroes["conversion_value"].sum():,.2f} in revenue - protect their budget.',
            "type": "opportunity",
        })
    if len(zombies):
        insights_list.append({
            "insight": f"{len(zombies)} zombie products with near-zero impressions - optimize feed or exclude.",
            "type": "waste",
        })
    if len(underperformers):
        wasted = underperformers["cost"].sum()
        insights_list.append({
            "insight": f'{len(underperformers)} underperformers wasting ${wasted:,.2f} - isolate or exclude.',
            "type": "waste",
        })

    product_detail_cols = ["product_id", "title", "category", "margin_tier", "perf_tier",
                           "margin_pct", "break_even_roas", "roas", "cost", "conversions", "conversion_value"]
    product_detail_cols = [c for c in product_detail_cols if c in df.columns]

    return {
        "Asset Group Recommendations": asset_groups,
        "Product Detail": df[product_detail_cols],
        "Insights": pd.DataFrame(insights_list) if insights_list else pd.DataFrame(),
    }
