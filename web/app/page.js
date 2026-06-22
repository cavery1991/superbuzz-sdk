'use client';

import { useCallback, useRef, useState } from 'react';

const money = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());
const scoreCls = (n) => (n >= 75 ? 's-good' : n >= 45 ? 's-warn' : 's-bad');
const verdictBadge = (v) => <span className={`badge b-${v}`}><span className="dot-s" />{v}</span>;

export default function Page() {
  const [report, setReport] = useState(null);
  const [feedText, setFeedText] = useState('');
  const [view, setView] = useState('upload'); // 'upload' | 'app'
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [predictSeed, setPredictSeed] = useState('waterproof hiking boots');
  const goPredict = (q) => { setPredictSeed(q); setTab('predict'); };

  const analyze = useCallback(async ({ feed, url, searchTerms }) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feed, url, searchTerms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setFeedText(data.feed || feed || ''); // resolved feed text (incl. fetched-from-URL)
      setReport(data.report);
      setView('app'); setTab('overview');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, []);

  const loadSample = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/sample');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load sample');
      await analyze({ feed: data.feed, searchTerms: data.searchTerms });
    } catch (e) { setError(e.message); setBusy(false); }
  }, [analyze]);

  if (view === 'upload') {
    return (
      <Upload
        onFeed={(feed) => analyze({ feed })}
        onUrl={(url) => analyze({ url })}
        onSample={loadSample}
        busy={busy}
        error={error}
      />
    );
  }

  const s = report.summary;
  return (
    <>
      <div className="bar"><div className="bar-in">
        <div className="logo"><span className="dot" />ShopGraph</div>
        <div className="nav">
          {['overview', 'predict', 'scan', 'products', 'opps'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {({ overview: 'Overview', predict: 'Predict', scan: 'Scan PDP', products: 'Products', opps: 'Opportunities' })[t]}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="pill" onClick={() => { setView('upload'); setReport(null); }}>↑ New feed</button>
      </div></div>

      <div className="wrap">
        {tab === 'overview' && <Overview report={report} s={s} onQuery={goPredict} />}
        {tab === 'predict' && <Predict key={predictSeed} feed={feedText} initial={predictSeed} onProduct={(id) => setDrawer(report.products.find((p) => p.id === id))} />}
        {tab === 'scan' && <Scan />}
        {tab === 'products' && <Products report={report} onProduct={(p) => setDrawer(p)} />}
        {tab === 'opps' && <Opportunities report={report} onQuery={goPredict} />}
      </div>

      {drawer && <Drawer product={drawer} onClose={() => setDrawer(null)} />}
    </>
  );
}

/* ---------- Upload ---------- */
function Upload({ onFeed, onUrl, onSample, busy, error }) {
  const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState('');
  const fileRef = useRef(null);
  const onFile = async (file) => { if (file) onFeed(await file.text()); };
  const submitUrl = () => { if (url.trim()) onUrl(url.trim()); };
  return (
    <div className="wrap center">
      <div className="logo" style={{ fontSize: 20, marginBottom: 22 }}><span className="dot" />ShopGraph</div>
      <h1>Will your products appear?</h1>
      <div className="sub">Paste a feed URL or upload a client&apos;s product feed (XML, CSV, TSV or JSON).</div>

      <div className="search" style={{ width: 'min(560px,92vw)', marginBottom: 16 }}>
        <span>🔗</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
          placeholder="https://feeds.datafeedwatch.com/…/feed.xml" autoComplete="off" />
        <button className="btn" onClick={submitUrl} disabled={busy}>{busy ? <span className="spin" /> : 'Analyze'}</button>
      </div>

      <div className="small muted" style={{ margin: '2px 0 14px' }}>— or —</div>

      <div
        className={`drop ${drag ? 'drag' : ''}`}
        style={{ width: 'min(560px,92vw)' }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        <div style={{ fontSize: 30 }}>📦</div>
        <div className="big">{busy ? 'Analyzing…' : 'Drop a feed file or click to browse'}</div>
        <div className="small muted">Merchant Center XML/RSS · CSV · TSV · JSON</div>
        <input ref={fileRef} type="file" accept=".xml,.csv,.tsv,.txt,.json,application/json,text/csv,text/xml"
          style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onSample} disabled={busy}>Use sample feed</button>
      </div>
      {error && <div style={{ color: 'var(--red)', marginTop: 16, maxWidth: 560 }}>{error}</div>}
    </div>
  );
}

/* ---------- Overview ---------- */
function Overview({ report, s, onQuery }) {
  const total = s.coverage.well + s.coverage.weak + s.coverage.gap || 1;
  const pct = (n) => Math.round((n / total) * 100);
  return (
    <>
      <h1>Feed overview</h1>
      <div className="sub">How your catalog matches shopper demand today — and the upside from fixing it.</div>
      {s.truncated && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#f0b429', background: 'var(--amber-bg)', color: 'var(--amber)' }}>
          Large feed: analyzing the first <b>{s.products}</b> of <b>{s.totalProducts}</b> products for speed.
        </div>
      )}
      <div className="cards">
        <Kpi k="Avg feed score" v={<>{s.avgFeedScore}<small>/100</small></>} d={`${s.compliance.atRisk} at disapproval risk`} />
        <Kpi k="Well-covered" v={<>{s.coverage.well}<small>/{total}</small></>} d={`${pct(s.coverage.well)}% of tracked queries`} />
        <Kpi k="Revenue opportunity" cls="up" v={<>{money(s.revenue.totalMonthly)}<small>/mo</small></>} d={`${money(s.revenue.totalAnnual)}/yr from fixes`} />
        <Kpi k="Lift from fixes" cls="up" v={<>+{s.estimatedLift.coverageGain}<small> queries</small></>} d={`${s.estimatedLift.queriesFixed} newly fixable`} />
      </div>
      <div className="section"><h2>Coverage</h2><div className="body">
        <div className="cov">
          {pct(s.coverage.well) > 0 && <span className="well" style={{ width: pct(s.coverage.well) + '%' }}>{s.coverage.well}</span>}
          {pct(s.coverage.weak) > 0 && <span className="weak" style={{ width: pct(s.coverage.weak) + '%' }}>{s.coverage.weak}</span>}
          {pct(s.coverage.gap) > 0 && <span className="gap" style={{ width: pct(s.coverage.gap) + '%' }}>{s.coverage.gap}</span>}
        </div>
        <div className="legend"><b>{s.coverage.well}</b> well-covered · <b>{s.coverage.weak}</b> weak · <b>{s.coverage.gap}</b> gaps. Applying every fix lifts well-covered <b>{s.estimatedLift.wellBefore} → {s.estimatedLift.wellAfter}</b>.</div>
      </div></div>
      <div className="section"><h2>Top opportunities</h2>
        <table><thead><tr><th></th><th>Query</th><th>Status</th><th className="r">Value</th><th className="r">Before → after</th></tr></thead>
          <tbody>{report.gaps.slice(0, 8).map((g, i) => (
            <tr key={i} onClick={() => onQuery(g.query)}>
              <td>{g.wouldFix ? <span className="up" style={{ fontWeight: 700 }}>✓</span> : ''}</td>
              <td style={{ fontWeight: 600 }}>{g.query}</td>
              <td><span className={`badge b-${g.bucket === 'weak' ? 'borderline' : 'absent'}`}>{g.bucket}</span></td>
              <td className="r num">{Math.round(g.value)}</td>
              <td className="r num">{g.bestScore} → <b>{g.afterScore}</b></td>
            </tr>))}</tbody></table>
      </div>
    </>
  );
}
function Kpi({ k, v, d, cls }) {
  return <div className="card kpi"><div className="k">{k}</div><div className={`v ${cls || ''}`}>{v}</div><div className="d">{d}</div></div>;
}

/* ---------- Predict ---------- */
function Predict({ feed, initial, onProduct }) {
  const [q, setQ] = useState(initial || 'waterproof hiking boots');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (query) => {
    if (!query.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feed, query }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Prediction failed');
      setRes(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const group = (v) => (res ? res.rows.filter((r) => r.verdict === v) : []);
  const Col = ({ title, v, clr }) => (
    <div className="vcol"><h3><span className="dot-s" style={{ background: clr }} />{title} ({group(v).length})</h3>
      {group(v).length ? group(v).map((r) => (
        <div key={r.id} className="vcard" onClick={() => onProduct(r.id)}>
          <div className="t">{r.title}</div>
          <div className="m">{r.id} · relevance {r.relevance}{r.rank ? ` · rank #${r.rank}` : ''}{r.eligibilityIssues?.length ? ` · ${r.eligibilityIssues.join(', ')}` : ''}</div>
          <div className="meter"><i style={{ width: Math.round((r.probability || r.relevance) * 100) + '%' }} /></div>
        </div>)) : <div className="small muted" style={{ padding: '6px 2px' }}>None</div>}
    </div>
  );
  return (
    <>
      <h1>Will my products appear?</h1>
      <div className="sub">Type any search term to see which products would show — and why.</div>
      <div className="search">
        <span>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run(q)} placeholder="e.g. waterproof hiking boots" />
        <button className="btn" onClick={() => run(q)} disabled={busy}>{busy ? <span className="spin" /> : 'Predict'}</button>
      </div>
      {err && <div style={{ color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {res && <>
        <div className="muted small" style={{ margin: '-4px 0 16px' }}>Inferred aisle: {res.aisle || '(none)'} · {res.counts.appears} appear · {res.counts.borderline} borderline · {res.counts.absent} absent · {res.counts.ineligible} ineligible</div>
        <div className="verdict-cols">
          <div><Col title="Would appear" v="appears" clr="var(--green)" /><Col title="Borderline" v="borderline" clr="#f0b429" /></div>
          <div><Col title="Ineligible — can't serve" v="ineligible" clr="var(--red)" /><Col title="Won't appear" v="absent" clr="var(--slate)" /></div>
        </div>
      </>}
    </>
  );
}

/* ---------- Scan PDP ---------- */
function Scan() {
  const [url, setUrl] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async () => {
    if (!url.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Scan failed');
      setRes(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const icon = { likely: 'var(--green)', possible: '#f0b429', unlikely: 'var(--slate)', ineligible: 'var(--red)' };
  return (
    <>
      <h1>Scan a product page</h1>
      <div className="sub">Paste a product detail page URL. We extract the product, infer the searches it should target, and score how likely it is to appear.</div>
      <div className="search">
        <span>🔗</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="https://store.com/products/…" />
        <button className="btn" onClick={run} disabled={busy}>{busy ? <span className="spin" /> : 'Scan'}</button>
      </div>
      {err && <div style={{ color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {res && <>
        <div className="section"><div className="body">
          <div style={{ fontWeight: 700, fontSize: 16 }}>{res.product.title}</div>
          <div className="small muted" style={{ marginTop: 3 }}>
            {res.product.brand || '—'} · {money(res.product.price)} · {res.product.inStock ? 'in stock' : 'OUT OF STOCK'} · {res.product.categoryPath || 'no category'}
          </div>
          {!res.eligible && <div style={{ color: 'var(--red)', marginTop: 8 }}>⚠ Ineligible to serve: {res.eligibilityIssues.join(', ')}</div>}
        </div></div>
        <div className="section"><h2>Searches this product could target</h2>
          <table><thead><tr><th>Likelihood</th><th>Verdict</th><th>Query</th></tr></thead>
            <tbody>{res.queries.map((qq, i) => (
              <tr key={i}>
                <td className="num" style={{ width: 110 }}>
                  <div className="meter" style={{ marginTop: 0 }}><i style={{ width: Math.round(qq.likelihood * 100) + '%' }} /></div>
                  <span className="small muted">{Math.round(qq.likelihood * 100)}%</span>
                </td>
                <td><span className="badge" style={{ background: 'transparent', color: icon[qq.verdict] }}><span className="dot-s" style={{ background: icon[qq.verdict] }} />{qq.verdict}</span></td>
                <td style={{ fontWeight: 600 }}>{qq.query}</td>
              </tr>))}</tbody></table>
        </div>
      </>}
    </>
  );
}

/* ---------- Products ---------- */
function Products({ report, onProduct }) {
  return (
    <>
      <h1>Products</h1><div className="sub">Per-product feed health, coverage lift, price position and policy risk.</div>
      <div className="section"><table>
        <thead><tr><th>Score</th><th>Product</th><th className="r">Coverage</th><th>Price</th><th>Status</th></tr></thead>
        <tbody>{report.products.map((p) => (
          <tr key={p.id} onClick={() => onProduct(p)}>
            <td><span className={`score ${scoreCls(p.feedScore)}`}>{p.feedScore}</span></td>
            <td><div style={{ fontWeight: 600 }}>{p.title || p.id}</div><div className="small muted">{p.id}</div></td>
            <td className="r num">{p.simulation.beforeCovered} → <b>{p.simulation.afterCovered}</b></td>
            <td>{p.price.position === 'above' ? <span className="flag">+{Math.round((p.price.ratioToMedian - 1) * 100)}% vs mkt</span> : <span className="small muted">{p.price.position}</span>}</td>
            <td>{p.compliance.willLikelyDisapprove ? <span className="flag">disapproval risk</span> : <span className="small" style={{ color: 'var(--green)' }}>ok</span>}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}

/* ---------- Opportunities ---------- */
function Opportunities({ report, onQuery }) {
  return (
    <>
      <h1>Opportunities</h1><div className="sub">Every tracked query not strongly covered, ranked. ✓ = a recommended fix would newly cover it.</div>
      <div className="section"><table>
        <thead><tr><th></th><th>Query</th><th>Status</th><th>Source</th><th className="r">Value</th><th className="r">Before → after</th></tr></thead>
        <tbody>{report.gaps.map((g, i) => (
          <tr key={i} onClick={() => onQuery(g.query)}>
            <td>{g.wouldFix ? <span className="up" style={{ fontWeight: 700 }}>✓</span> : ''}</td>
            <td style={{ fontWeight: 600 }}>{g.query}</td>
            <td><span className={`badge b-${g.bucket === 'weak' ? 'borderline' : 'absent'}`}>{g.bucket}</span></td>
            <td><span className="small muted">{g.source}</span></td>
            <td className="r num">{Math.round(g.value)}</td>
            <td className="r num">{g.bestScore} → <b>{g.afterScore}</b></td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}

/* ---------- Drawer ---------- */
function Drawer({ product: p, onClose }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="dh">
          <button className="x" onClick={onClose}>✕</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`score ${scoreCls(p.feedScore)}`}>{p.feedScore}</span>
            <div><div style={{ fontWeight: 700, fontSize: 16 }}>{p.title || p.id}</div><div className="small muted">{p.id}</div></div>
          </div>
        </div>
        <div className="dc">
          <div className="kv"><span className="muted">Coverage (category)</span><span><b>{p.simulation.beforeCovered} → {p.simulation.afterCovered}</b> of {p.simulation.relevantQueries} (+{p.simulation.newlyCovered})</span></div>
          <div className="kv"><span className="muted">Price position</span><span>{p.price.position}{p.price.marketMedian ? ` (market ${p.price.marketMedian})` : ''}</span></div>
          <div className="kv"><span className="muted">Policy</span><span>{p.compliance.willLikelyDisapprove ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>disapproval risk</span> : <span style={{ color: 'var(--green)' }}>eligible</span>}</span></div>
          {p.simulation.suggestedTitle && <div className="kv" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><span className="muted">Suggested title</span><span style={{ fontWeight: 600 }}>{p.simulation.suggestedTitle}</span></div>}
          <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--subtle)', margin: '18px 0 2px' }}>Recommended fixes</h2>
          {p.recommendations.length ? p.recommendations.map((r, i) => (
            <div key={i} className="rec"><span className={`pri ${r.priority}`}>{r.priority}</span><span>{r.message}</span></div>
          )) : <div className="small muted" style={{ padding: '8px 0' }}>No issues — well-built feed.</div>}
        </div>
      </aside>
    </>
  );
}
