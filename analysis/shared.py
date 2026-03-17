"""Shared utilities: metrics, tokenization, similarity."""

import re
from collections import Counter


def calc_metrics(row):
    impressions = row.get("impressions", 0)
    clicks = row.get("clicks", 0)
    cost = row.get("cost", 0)
    conversions = row.get("conversions", 0)
    conversion_value = row.get("conversion_value", 0)
    return {
        "ctr": clicks / impressions if impressions else 0,
        "cpc": cost / clicks if clicks else 0,
        "conversion_rate": conversions / clicks if clicks else 0,
        "cpa": cost / conversions if conversions else float("inf"),
        "roas": conversion_value / cost if cost else 0,
    }


def tokenize(text):
    return [t for t in re.sub(r"[^a-z0-9\s]", " ", text.lower()).split() if t]


def jaccard(a, b):
    sa, sb = set(a), set(b)
    union = sa | sb
    return len(sa & sb) / len(union) if union else 0


def top_tokens(terms, min_ratio=0.5, limit=3):
    freq = Counter()
    for t in terms:
        freq.update(set(tokenize(t)))
    threshold = len(terms) * min_ratio
    return [tok for tok, cnt in freq.most_common(limit) if cnt >= threshold]
