"""Search Term Triage Assistant: daily action queue from search query analysis."""

import pandas as pd
from .shared import calc_metrics, tokenize


def triage_term(row, target_roas=3.0, min_clicks=10, min_spend_neg=20,
                isolation_roas=5.0, isolation_min_conv=3):
    """Decide a single triage action for one search term."""
    if row["clicks"] < min_clicks:
        return None

    m = calc_metrics(row)
    is_pmax = (row.get("match_type") == "auto" or
               "pmax" in str(row.get("campaign", "")).lower())

    # Zero conversions + significant spend → negative
    if row["conversions"] == 0 and row["cost"] >= min_spend_neg:
        return {
            "action": "add_negative",
            "priority": "high" if row["cost"] >= min_spend_neg * 3 else "medium",
            "reason": f'${row["cost"]:.2f} spend, {int(row["clicks"])} clicks, 0 conversions',
            "cost_savings": round(row["cost"], 2),
            "revenue_opportunity": 0,
        }

    # Very low ROAS → negative
    if row["conversions"] > 0 and m["roas"] < target_roas * 0.25 and row["cost"] >= min_spend_neg:
        return {
            "action": "add_negative",
            "priority": "medium",
            "reason": f'ROAS {m["roas"]:.2f} is <25% of target {target_roas}',
            "cost_savings": round(row["cost"] * 0.75, 2),
            "revenue_opportunity": 0,
        }

    # High performer → isolate
    if m["roas"] >= isolation_roas and row["conversions"] >= isolation_min_conv:
        tokens = tokenize(row["search_term"])
        action = "isolate_new_campaign" if len(tokens) >= 4 else "isolate_new_adgroup"
        return {
            "action": action,
            "priority": "high",
            "reason": f'ROAS {m["roas"]:.2f}, {int(row["conversions"])} conv - isolate for bid control',
            "cost_savings": 0,
            "revenue_opportunity": round(row["conversion_value"] * 0.3, 2),
        }

    # Acceptable → leave
    action = "leave_in_pmax" if is_pmax else "leave_in_broad"
    return {
        "action": action,
        "priority": "low",
        "reason": f'ROAS {m["roas"]:.2f} - monitor',
        "cost_savings": 0,
        "revenue_opportunity": 0,
    }


def find_landing_page_gaps(df):
    results = []
    if "landing_page" not in df.columns:
        return pd.DataFrame()

    for _, r in df.iterrows():
        lp = r.get("landing_page")
        if pd.isna(lp) or not lp:
            if r["clicks"] > 0:
                results.append({
                    "search_term": r["search_term"],
                    "issue": "no_landing_page",
                    "action": f'Create landing page for "{r["search_term"]}"',
                    "estimated_impact": round(r["conversion_value"] * 1.5 if r["conversion_value"] > 0 else r["cost"], 2),
                })
            continue

        term_tokens = tokenize(r["search_term"])
        page_tokens = set(tokenize(str(lp).replace("/", " ").replace("-", " ")))
        match_ratio = sum(1 for t in term_tokens if t in page_tokens) / len(term_tokens) if term_tokens else 0

        if match_ratio < 0.3 and r["clicks"] >= 5:
            results.append({
                "search_term": r["search_term"],
                "issue": "low_relevance",
                "current_landing_page": lp,
                "action": f'Landing page may not match intent - review',
                "estimated_impact": round(r["conversion_value"] * 0.3 if r["conversion_value"] > 0 else r["cost"] * 0.5, 2),
            })

    return pd.DataFrame(results).sort_values("estimated_impact", ascending=False) if results else pd.DataFrame()


def run(df):
    """Run search term triage. Returns dict of DataFrames."""
    df = df.copy()

    actions = []
    for _, row in df.iterrows():
        result = triage_term(row)
        if result:
            actions.append({"search_term": row["search_term"], **result})

    action_df = pd.DataFrame(actions)
    if not action_df.empty:
        priority_order = {"high": 0, "medium": 1, "low": 2}
        action_df["_priority_sort"] = action_df["priority"].map(priority_order)
        action_df = action_df.sort_values(
            ["_priority_sort", "cost_savings"], ascending=[True, False]
        ).drop(columns=["_priority_sort"])

    lp_gaps = find_landing_page_gaps(df)

    # Summary
    summary_data = {}
    if not action_df.empty:
        summary_data = {
            "metric": [
                "Terms analyzed",
                "Add as negative",
                "Isolate (new ad group)",
                "Isolate (new campaign)",
                "Leave in broad/PMax",
                "Est. cost savings",
                "Est. revenue opportunity",
            ],
            "value": [
                len(df),
                len(action_df[action_df["action"] == "add_negative"]),
                len(action_df[action_df["action"] == "isolate_new_adgroup"]),
                len(action_df[action_df["action"] == "isolate_new_campaign"]),
                len(action_df[action_df["action"].isin(["leave_in_broad", "leave_in_pmax"])]),
                f'${action_df["cost_savings"].sum():,.2f}',
                f'${action_df["revenue_opportunity"].sum():,.2f}',
            ],
        }

    return {
        "Action Queue": action_df,
        "Landing Page Gaps": lp_gaps,
        "Summary": pd.DataFrame(summary_data) if summary_data else pd.DataFrame(),
    }
