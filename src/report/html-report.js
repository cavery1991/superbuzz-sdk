/**
 * HTML report renderer — turns an `analyzeFeed` report into a standalone,
 * dependency-free HTML page a merchant can actually read: summary cards, a
 * before/after coverage bar, a ranked opportunities table, and per-product feed
 * fixes with simulated coverage lift.
 */

/**
 * @param {object} report  output of analyzeFeed
 * @param {object} [meta]   { feedFile, searchTermsFile, generatedAt }
 * @returns {string} a complete HTML document
 */
export function renderHtmlReport(report, meta = {}) {
  const s = report.summary;
  const lift = s.estimatedLift;
  const total = s.coverage.well + s.coverage.weak + s.coverage.gap || 1;
  const pct = (n) => Math.round((n / total) * 100);

  const cards = [
    card('Products', s.products),
    card('Avg feed score', `${s.avgFeedScore}<span class="unit">/100</span>`, scoreClass(s.avgFeedScore)),
    card('Well-covered', `${s.coverage.well}<span class="unit">/${total}</span>`),
    card('Lift from fixes', `${signed(lift.coverageGain)}<span class="unit"> queries</span>`, lift.coverageGain > 0 ? 'good' : ''),
    s.revenue ? card('Revenue opportunity', `$${Math.round(s.revenue.totalMonthly).toLocaleString()}<span class="unit">/mo</span>`, s.revenue.totalMonthly > 0 ? 'good' : '') : '',
    s.compliance ? card('Disapproval risk', `${s.compliance.atRisk}<span class="unit"> products</span>`, s.compliance.atRisk > 0 ? 'bad' : 'good') : '',
  ].join('');

  const opportunities = report.gaps.slice(0, 20).map((g) => `
      <tr class="${g.wouldFix ? 'fixable' : ''}">
        <td>${g.wouldFix ? '✓' : ''}</td>
        <td class="q">${esc(g.query)}</td>
        <td><span class="tag ${g.bucket}">${g.bucket}</span></td>
        <td><span class="tag src">${g.source}</span></td>
        <td class="num">${Math.round(g.value)}</td>
        <td class="num">${g.bestScore} → <strong>${g.afterScore}</strong></td>
      </tr>`).join('');

  const products = report.products.map((p) => `
      <div class="product">
        <div class="phead">
          <span class="badge ${scoreClass(p.feedScore)}">${p.feedScore}</span>
          <div>
            <div class="ptitle">${esc(p.title || p.id)}
              ${p.compliance?.willLikelyDisapprove ? '<span class="tag gap">disapproval risk</span>' : ''}
              ${p.price?.position === 'above' ? `<span class="tag weak">+${Math.round((p.price.ratioToMedian - 1) * 100)}% vs market</span>` : ''}</div>
            <div class="pmeta">${esc(p.id)} · coverage ${p.simulation.beforeCovered} → <strong>${p.simulation.afterCovered}</strong>
              of ${p.simulation.relevantQueries} category queries (+${p.simulation.newlyCovered})</div>
          </div>
        </div>
        ${p.recommendations.length ? `<ul class="recs">${p.recommendations.slice(0, 8)
          .map((r) => `<li><span class="pri ${r.priority}">${r.priority}</span>${esc(r.message)}</li>`).join('')}</ul>`
          : '<div class="ok">No issues — well-built feed.</div>'}
      </div>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feed Analysis Report</title>
<style>
  :root{--bg:#0f172a;--card:#1e293b;--muted:#94a3b8;--line:#334155;--good:#22c55e;--warn:#f59e0b;--bad:#ef4444;--accent:#38bdf8}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a}
  header{background:var(--bg);color:#fff;padding:28px 32px}
  header h1{margin:0 0 4px;font-size:20px} header .sub{color:var(--muted);font-size:13px}
  main{max-width:980px;margin:0 auto;padding:24px 32px 64px}
  .cards{display:flex;gap:14px;flex-wrap:wrap;margin:-44px 0 28px}
  .c{flex:1;min-width:150px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .c .k{color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em} .c .v{font-size:26px;font-weight:700;margin-top:4px}
  .c .unit{font-size:13px;color:#94a3b8;font-weight:500}
  .c.good .v{color:#16a34a} .c.warn .v{color:#d97706} .c.bad .v{color:#dc2626}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin:32px 0 12px}
  .bar{display:flex;height:26px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}
  .bar .seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600}
  .bar .well{background:#22c55e} .bar .weak{background:#f59e0b} .bar .gap{background:#ef4444}
  .legend{font-size:12px;color:#64748b;margin-top:6px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #f1f5f9;font-size:13px}
  th{background:#f8fafc;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  td.num{text-align:right;font-variant-numeric:tabular-nums} td.q{font-weight:600}
  tr.fixable td:first-child{color:#16a34a;font-weight:700}
  .tag{font-size:11px;padding:2px 7px;border-radius:999px;background:#e2e8f0;color:#475569}
  .tag.weak{background:#fef3c7;color:#92400e} .tag.gap{background:#fee2e2;color:#991b1b} .tag.src{background:#e0f2fe;color:#075985}
  .product{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
  .phead{display:flex;gap:14px;align-items:center}
  .badge{flex:none;width:46px;height:46px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:#94a3b8}
  .badge.good{background:#22c55e}.badge.warn{background:#f59e0b}.badge.bad{background:#ef4444}
  .ptitle{font-weight:600} .pmeta{color:#64748b;font-size:12px}
  ul.recs{margin:12px 0 0;padding:0;list-style:none} ul.recs li{padding:6px 0;border-top:1px solid #f1f5f9;font-size:13px}
  .pri{display:inline-block;width:62px;font-size:10px;text-transform:uppercase;letter-spacing:.03em;font-weight:700;color:#64748b}
  .pri.high{color:#dc2626}.pri.medium{color:#d97706}.pri.low{color:#64748b}
  .ok{color:#16a34a;font-size:13px;margin-top:8px} .foot{color:#94a3b8;font-size:12px;margin-top:32px}
</style></head>
<body>
<header>
  <h1>Google Shopping — Feed Analysis Report</h1>
  <div class="sub">${esc(meta.feedFile ?? 'feed')}${meta.searchTermsFile ? ` · search terms: ${esc(meta.searchTermsFile)}` : ' · query universe: generated'}
   · ${s.queryUniverse.total} queries (${s.queryUniverse.real} real, ${s.queryUniverse.generated} generated)
   · ${esc(meta.generatedAt ?? new Date().toISOString().slice(0, 10))}</div>
</header>
<main>
  <div class="cards">${cards}</div>

  <h2>Coverage today</h2>
  <div class="bar">
    ${seg('well', s.coverage.well, pct(s.coverage.well))}
    ${seg('weak', s.coverage.weak, pct(s.coverage.weak))}
    ${seg('gap', s.coverage.gap, pct(s.coverage.gap))}
  </div>
  <div class="legend">Well-covered (≥${s.thresholds.well}) · Weakly covered (≥${s.thresholds.weak}) · Gap.
    Applying every recommendation lifts well-covered ${lift.wellBefore} → <strong>${lift.wellAfter}</strong>
    (${signed(lift.valueCoverageGainPct)}% by value).</div>

  <h2>Top opportunities</h2>
  <table>
    <thead><tr><th></th><th>Query</th><th>Status</th><th>Source</th><th>Value</th><th>Match before → after</th></tr></thead>
    <tbody>${opportunities || '<tr><td colspan="6">No gaps — catalog covers the query universe well.</td></tr>'}</tbody>
  </table>

  <h2>Per-product fixes <span style="font-weight:400;text-transform:none;color:#94a3b8">(worst first)</span></h2>
  ${products}

  <div class="foot">Coverage is the share of queries matched at/above the relevance threshold — the metric that
  reflects whether feed optimization helps. Match estimates are produced by a semantic model standing in for
  Google's matching; connect real Search Terms / Content API data for ground-truth accuracy.</div>
</main>
</body></html>`;
}

function card(k, v, cls = '') {
  return `<div class="c ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
}
function seg(cls, n, p) {
  return p > 0 ? `<div class="seg ${cls}" style="width:${p}%">${n}</div>` : '';
}
function scoreClass(n) {
  return n >= 75 ? 'good' : n >= 45 ? 'warn' : 'bad';
}
function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
