"""Search Query Mining: intent, profitability, clusters, negatives, expansion."""

import pandas as pd
from .shared import calc_metrics, tokenize, jaccard, top_tokens

# ── Signals ──

TRANSACTIONAL = [
    "buy", "purchase", "order", "shop", "deal", "discount", "coupon", "sale",
    "price", "cheap", "best", "top", "review", "compare", "vs", "affordable",
    "free shipping", "near me", "online", "subscribe", "get", "hire",
]
INFORMATIONAL = [
    "how", "what", "why", "when", "where", "who", "which", "guide",
    "tutorial", "tips", "ideas", "examples", "definition", "meaning",
]
NAVIGATIONAL = [
    "login", "log in", "sign in", "signup", "sign up", "account",
    "dashboard", "support", "contact", "help", "download", "app",
]


def _matches_signal(tokens, text, signal):
    if " " in signal:
        return signal in text
    return signal in tokens


def classify_intent(term, brand_terms=None, competitor_terms=None):
    lower = term.lower()
    tokens = tokenize(lower)
    brand_terms = [b.lower() for b in (brand_terms or [])]
    competitor_terms = [c.lower() for c in (competitor_terms or [])]

    for b in brand_terms:
        if b in lower:
            return "brand"
    for c in competitor_terms:
        if c in lower:
            return "competitor"
    if any(_matches_signal(tokens, lower, s) for s in NAVIGATIONAL):
        return "navigational"
    if tokens and tokens[0] in INFORMATIONAL:
        return "informational"
    if any(_matches_signal(tokens, lower, s) for s in TRANSACTIONAL):
        return "high-intent-transactional"
    if len(tokens) >= 4:
        return "long-tail"
    return "generic"


def classify_profitability(row, profitable_roas=3.0, wasteful_roas=1.0, min_clicks=5):
    if row["clicks"] < min_clicks:
        return "marginal"
    m = calc_metrics(row)
    if m["roas"] >= profitable_roas:
        return "profitable"
    if m["roas"] < wasteful_roas:
        return "wasteful"
    return "marginal"


def find_negatives(df, roas_thresh=0.5, min_spend=10, zero_conv_clicks=10):
    results = []
    for _, r in df.iterrows():
        if r["cost"] < min_spend:
            continue
        m = calc_metrics(r)
        is_zero = r["conversions"] == 0 and r["clicks"] >= zero_conv_clicks
        is_low = r["conversions"] > 0 and m["roas"] < roas_thresh
        if is_zero or is_low:
            results.append({
                "search_term": r["search_term"],
                "match_type": "exact",
                "wasted_spend": round(r["cost"], 2),
                "clicks": int(r["clicks"]),
                "reason": (
                    f'{int(r["clicks"])} clicks, ${r["cost"]:.2f} spend, 0 conversions'
                    if is_zero
                    else f'ROAS {m["roas"]:.2f} below {roas_thresh}'
                ),
            })
    return pd.DataFrame(results).sort_values("wasted_spend", ascending=False) if results else pd.DataFrame()


def find_expansions(df, min_roas=2.0, min_conversions=2, min_clicks=10):
    results = []
    for _, r in df.iterrows():
        if r["clicks"] < min_clicks or r["conversions"] < min_conversions:
            continue
        m = calc_metrics(r)
        if m["roas"] < min_roas:
            continue
        tokens = tokenize(r["search_term"])
        results.append({
            "search_term": r["search_term"],
            "roas": round(m["roas"], 2),
            "conversions": int(r["conversions"]),
            "cpa": round(m["cpa"], 2),
            "monthly_value": round(r["conversion_value"], 2),
            "suggested_action": "create_new_adgroup" if len(tokens) >= 4 else "add_as_exact_keyword",
        })
    return pd.DataFrame(results).sort_values("monthly_value", ascending=False) if results else pd.DataFrame()


def cluster_terms(df, similarity=0.3, min_size=2):
    terms = df["search_term"].tolist()
    token_sets = [set(tokenize(t)) for t in terms]
    assigned = set()
    clusters = []

    for i in range(len(terms)):
        if i in assigned:
            continue
        group = [i]
        assigned.add(i)
        for j in range(i + 1, len(terms)):
            if j in assigned:
                continue
            if jaccard(token_sets[i], token_sets[j]) >= similarity:
                group.append(j)
                assigned.add(j)
        if len(group) >= min_size:
            cluster_df = df.iloc[group]
            label = " ".join(top_tokens(cluster_df["search_term"].tolist())) or terms[group[0]]
            clusters.append({
                "cluster": label,
                "term_count": len(group),
                "total_cost": round(cluster_df["cost"].sum(), 2),
                "total_conversions": int(cluster_df["conversions"].sum()),
                "total_value": round(cluster_df["conversion_value"].sum(), 2),
                "terms": ", ".join(cluster_df["search_term"].tolist()[:5]),
            })

    return pd.DataFrame(clusters).sort_values("total_cost", ascending=False) if clusters else pd.DataFrame()


def run(df):
    """Run full search query mining analysis. Returns dict of DataFrames."""
    df = df.copy()
    df["intent"] = df["search_term"].apply(classify_intent)
    df["profitability"] = df.apply(classify_profitability, axis=1)

    m = df.apply(lambda r: pd.Series(calc_metrics(r)), axis=1)
    df["roas"] = m["roas"].round(2)
    df["cpa"] = m["cpa"].round(2)
    df["ctr"] = m["ctr"].round(4)

    summary = df[["search_term", "intent", "profitability", "impressions",
                   "clicks", "cost", "conversions", "conversion_value", "roas", "cpa"]]

    return {
        "Summary": summary,
        "Negative Keyword Candidates": find_negatives(df),
        "Expansion Opportunities": find_expansions(df),
        "Query Clusters": cluster_terms(df),
    }
