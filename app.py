"""SuperBuzz SDK — Streamlit Web Interface."""

import io
import streamlit as st
import pandas as pd
from analysis import search_query_mining, pmax_segmentation, search_term_triage

# ── Column mapping: normalize user CSVs to internal names ──

COLUMN_ALIASES = {
    "search_term": ["search_term", "search term", "searchterm", "query", "search query", "search_query"],
    "impressions": ["impressions", "impr", "impr."],
    "clicks": ["clicks"],
    "cost": ["cost", "spend", "cost / conv.", "total cost"],
    "conversions": ["conversions", "conv", "conv.", "total conversions"],
    "conversion_value": ["conversion_value", "conv. value", "conversion value",
                         "total conversion value", "total conv. value", "revenue"],
    "match_type": ["match_type", "match type", "matchtype"],
    "campaign": ["campaign", "campaign name"],
    "ad_group": ["ad_group", "ad group", "adgroup"],
    "landing_page": ["landing_page", "landing page", "final url", "landing page url"],
    "product_id": ["product_id", "product id", "item id", "id", "sku"],
    "title": ["title", "product title", "item title", "product name"],
    "category": ["category", "product type", "product_type", "product category"],
    "brand": ["brand", "product brand"],
    "price": ["price", "item price", "product price"],
    "cost_of_goods": ["cost_of_goods", "cogs", "cost of goods", "cost of goods sold"],
    "gross_margin": ["gross_margin", "margin", "margin %", "margin_pct"],
}


def normalize_columns(df):
    """Map common CSV column names to internal names."""
    col_lower = {c.lower().strip(): c for c in df.columns}
    rename = {}
    for internal, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in col_lower and internal not in rename.values():
                rename[col_lower[alias]] = internal
                break
    return df.rename(columns=rename)


def to_csv_bytes(df):
    return df.to_csv(index=False).encode("utf-8")


# ── Required columns per analysis ──

REQUIRED = {
    "Search Query Mining": ["search_term", "impressions", "clicks", "cost", "conversions", "conversion_value"],
    "Search Term Triage": ["search_term", "impressions", "clicks", "cost", "conversions", "conversion_value"],
    "PMax Segmentation": ["product_id", "impressions", "clicks", "cost", "conversions", "conversion_value"],
}

ANALYSIS_DESCRIPTIONS = {
    "Search Query Mining": "Clusters search terms by intent, profitability, waste, expansion potential, and negative keyword candidates.",
    "Search Term Triage": "Turns search query data into a prioritized daily action queue: negate, isolate, leave, update feed titles, or flag landing page gaps.",
    "PMax Segmentation": "Segments products into campaigns and asset groups by margin tier and performance, with bid strategy recommendations.",
}

# ── App ──

st.set_page_config(page_title="SuperBuzz SDK", page_icon="📊", layout="wide")
st.title("📊 SuperBuzz SDK")
st.caption("Search query mining, PMax segmentation & search term triage")

# Sidebar
with st.sidebar:
    st.header("Settings")

    analysis = st.selectbox("Analysis type", list(REQUIRED.keys()))
    st.info(ANALYSIS_DESCRIPTIONS[analysis])

    st.divider()
    st.markdown("**Required CSV columns:**")
    for col in REQUIRED[analysis]:
        st.code(col, language=None)

    st.divider()
    st.markdown(
        "Columns are auto-detected from common Google Ads export formats. "
        "See the README for accepted column names."
    )

# Main area
uploaded = st.file_uploader("Upload your CSV", type=["csv"])

if uploaded is None:
    # Show sample data hint
    st.markdown("---")
    st.markdown("### Getting started")
    st.markdown(
        "Export a **Search Terms report** or **Products report** from Google Ads as CSV, then upload it above.\n\n"
        "Your CSV needs at minimum these columns (names are flexible — common Google Ads export names work):"
    )

    if analysis == "PMax Segmentation":
        sample = pd.DataFrame({
            "product_id": ["SKU-001", "SKU-002", "SKU-003"],
            "title": ["Running Shoe", "Dress Shirt", "Phone Case"],
            "category": ["Shoes", "Apparel", "Accessories"],
            "price": [120, 60, 15],
            "cost_of_goods": [40, 30, 10],
            "impressions": [5000, 2000, 100],
            "clicks": [200, 80, 2],
            "cost": [400, 160, 4],
            "conversions": [20, 5, 0],
            "conversion_value": [2400, 300, 0],
        })
    else:
        sample = pd.DataFrame({
            "search_term": ["buy running shoes", "free stuff online", "best laptop deals"],
            "impressions": [5000, 3000, 4000],
            "clicks": [200, 100, 150],
            "cost": [400, 200, 300],
            "conversions": [20, 0, 10],
            "conversion_value": [2400, 0, 1500],
        })

    st.dataframe(sample, width="stretch")
    st.stop()

# ── Load & validate ──

df = pd.read_csv(uploaded)
df = normalize_columns(df)

# Check required columns
missing = [c for c in REQUIRED[analysis] if c not in df.columns]
if missing:
    st.error(
        f"Missing required columns: **{', '.join(missing)}**\n\n"
        f"Your CSV has: {', '.join(df.columns.tolist())}"
    )
    st.stop()

# Ensure numeric columns
numeric_cols = ["impressions", "clicks", "cost", "conversions", "conversion_value",
                "price", "cost_of_goods", "gross_margin"]
for col in numeric_cols:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", ""), errors="coerce").fillna(0)

st.success(f"Loaded **{len(df):,}** rows with columns: {', '.join(df.columns.tolist())}")

# ── Run ──

if st.button("🚀 Run Analysis", type="primary", width="stretch"):
    with st.spinner("Analyzing..."):
        if analysis == "Search Query Mining":
            results = search_query_mining.run(df)
        elif analysis == "Search Term Triage":
            results = search_term_triage.run(df)
        else:
            results = pmax_segmentation.run(df)

    # Display results
    for section_name, section_df in results.items():
        st.markdown(f"### {section_name}")
        if section_df is not None and not section_df.empty:
            st.dataframe(section_df, width="stretch", hide_index=True)
            st.download_button(
                label=f"⬇ Download {section_name} as CSV",
                data=to_csv_bytes(section_df),
                file_name=f"{section_name.lower().replace(' ', '_')}.csv",
                mime="text/csv",
            )
        else:
            st.caption("No results for this section.")
        st.markdown("")
