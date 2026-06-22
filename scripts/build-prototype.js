/**
 * Builds a self-contained, interactive HTML prototype of the product UI from
 * REAL engine output (analyzeFeed + predictAppearance), in a light "Stripe-clean"
 * design language. No build step, no CDN, no external assets — open the file.
 *
 *   node scripts/build-prototype.js [--out prototype.html] [--feed feed.json] [--terms terms.csv]
 *
 * Note: data is precomputed with the offline embedder; the Predict tab works over
 * a precomputed set of search terms (a prototype can't run the model in-browser).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createShoppingSystem, analyzeFeed, ingestFeed, buildProductProfile,
  auditProduct, optimizeProduct, predictAppearance,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = (f) => resolve(__dirname, '../data', f);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const feedFile = arg('feed', DATA('feed.sample.json'));
const termsFile = arg('terms', DATA('search-terms.sample.csv'));
const outFile = arg('out', resolve(process.cwd(), 'prototype.html'));

const feed = readFileSync(feedFile, 'utf8');
const searchTermsCsv = readFileSync(termsFile, 'utf8');

// --- 1. Analyze report (real) ----------------------------------------------
const report = analyzeFeed({ feed, searchTermsCsv });

// --- 2. Predict (real) for a curated set of search terms -------------------
const sys = createShoppingSystem();
const items = ingestFeed(feed, sys.taxonomy);
const rawById = new Map();
const optimizedById = new Map();
for (const it of items) {
  const profile = buildProductProfile({
    feed: it.product, schema: it.raw.schema,
    visionTags: it.raw.visionTags ?? (it.raw.vision_tags ? String(it.raw.vision_tags).split(/[;,|]/) : undefined),
    reviews: it.raw.reviews,
  });
  const stored = sys.engine.index({ ...it.product });
  rawById.set(stored.id, it.raw);
  const audit = auditProduct({ raw: it.raw, provided: it.provided, product: stored, classifier: sys.classifier, taxonomy: sys.taxonomy, derivedTags: profile.derivedTags });
  const opt = optimizeProduct({ raw: it.raw, product: stored, audit, taxonomy: sys.taxonomy, derivedTags: profile.derivedTags, derivedConcepts: profile.derivedConcepts });
  optimizedById.set(stored.id, sys.embedder.embed(opt.optimizedText));
}

const QUERIES = [
  'waterproof hiking boots', 'warm winter coat', 'wireless noise cancelling headphones',
  'blue running shoes', 'nonstick frying pan', 'laptop backpack',
  'insulated parka for snow', 'cozy fleece hoodie',
];
const predictions = QUERIES.map((q) => {
  const out = predictAppearance({ engine: sys.engine, query: q, appearThreshold: 0.45, rawById, taxonomy: sys.taxonomy, optimizedById });
  const aisle = out.intentCategoryId != null ? sys.taxonomy.get(out.intentCategoryId) : null;
  return {
    query: q,
    aisle: aisle ? aisle.path : null,
    counts: out.counts,
    rows: out.rows.map((r) => ({
      id: r.id, title: r.title, verdict: r.verdict, relevance: r.relevance,
      probability: r.probability, rank: r.rank, eligibilityIssues: r.eligibilityIssues,
      missingTerms: r.missingTerms, afterFix: r.afterFix, reasons: r.reasons,
    })),
  };
});

const DATA_BLOB = JSON.stringify({ report, predictions, feedFile: feedFile.split('/').pop() });

writeFileSync(outFile, html(DATA_BLOB));
console.log(`Prototype written to ${outFile}`);

// ---------------------------------------------------------------------------
function html(dataJson) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShopGraph — Feed Intelligence</title>
<style>
:root{
  --bg:#f6f9fc; --surface:#fff; --ink:#0a2540; --muted:#425466; --subtle:#8792a2;
  --line:#e6ebf1; --brand:#635bff; --brand-2:#7a73ff; --brand-soft:#f5f4ff;
  --green:#0e9f6e; --green-bg:#e6f6ef; --amber:#b45309; --amber-bg:#fdf3e2;
  --red:#dc2f57; --red-bg:#fdecf1; --slate:#647387; --slate-bg:#eef1f5;
  --shadow:0 2px 5px -1px rgba(50,50,93,.10),0 1px 3px -1px rgba(0,0,0,.07);
  --shadow-lg:0 13px 27px -5px rgba(50,50,93,.18),0 8px 16px -8px rgba(0,0,0,.18);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14.5px/1.55 Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums}
a{color:var(--brand);text-decoration:none}
/* top bar */
header{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.85);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid var(--line)}
.bar{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:28px;padding:0 24px;height:60px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16px;letter-spacing:-.01em}
.logo .dot{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 2px 6px rgba(99,91,255,.5)}
nav{display:flex;gap:4px;margin-left:6px}
nav button{font:inherit;font-weight:550;color:var(--muted);background:none;border:0;padding:8px 13px;border-radius:8px;cursor:pointer}
nav button:hover{background:var(--brand-soft);color:var(--brand)}
nav button.active{background:var(--brand-soft);color:var(--brand)}
.bar .spacer{flex:1}
.pill{font-size:12px;color:var(--subtle);border:1px solid var(--line);border-radius:999px;padding:5px 11px;background:#fff}
main{max-width:1120px;margin:0 auto;padding:28px 24px 80px}
h1{font-size:22px;letter-spacing:-.02em;margin:0 0 4px}
.sub{color:var(--subtle);font-size:13px;margin-bottom:22px}
.tab{display:none} .tab.active{display:block;animation:fade .25s ease}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
/* cards */
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:var(--shadow)}
.kpi .k{font-size:12px;color:var(--subtle);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.kpi .v{font-size:30px;font-weight:740;letter-spacing:-.02em;margin-top:7px}
.kpi .v small{font-size:14px;color:var(--subtle);font-weight:600}
.kpi .d{font-size:12.5px;margin-top:5px;color:var(--muted)}
.up{color:var(--green)} .down{color:var(--red)}
.section{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden}
.section h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--subtle);margin:0;padding:16px 18px;border-bottom:1px solid var(--line)}
.section .body{padding:6px 18px 16px}
/* coverage bar */
.cov{display:flex;height:30px;border-radius:9px;overflow:hidden;margin:14px 0 8px;box-shadow:inset 0 0 0 1px var(--line)}
.cov span{display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:650}
.cov .well{background:var(--green)} .cov .weak{background:#f0b429;color:#5b4708} .cov .gap{background:var(--red)}
.legend{font-size:12.5px;color:var(--muted)}
.legend b{color:var(--ink)}
/* table */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:11px 18px;border-bottom:1px solid var(--line);font-size:13.5px}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--subtle);font-weight:600;background:#fbfcfe}
tbody tr{cursor:pointer;transition:background .12s}
tbody tr:hover{background:var(--brand-soft)}
td.r{text-align:right}
/* badges */
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:650;padding:3px 9px;border-radius:999px;white-space:nowrap}
.b-appears{background:var(--green-bg);color:var(--green)}
.b-borderline{background:var(--amber-bg);color:var(--amber)}
.b-absent{background:var(--slate-bg);color:var(--slate)}
.b-ineligible{background:var(--red-bg);color:var(--red)}
.dot-s{width:7px;height:7px;border-radius:50%;display:inline-block}
.score{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;font-weight:700;font-size:14px;color:#fff}
.s-good{background:var(--green)} .s-warn{background:#f0b429;color:#5b4708} .s-bad{background:var(--red)}
.flag{font-size:11px;font-weight:600;color:var(--red);background:var(--red-bg);padding:2px 8px;border-radius:6px}
.flag.warn{color:var(--amber);background:var(--amber-bg)}
/* predict */
.search{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;box-shadow:var(--shadow);margin-bottom:14px}
.search input{flex:1;border:0;outline:0;font:inherit;font-size:15px;color:var(--ink);background:none}
.search .ic{color:var(--subtle)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.chip{font-size:13px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 13px;cursor:pointer;color:var(--muted);font-weight:550}
.chip:hover{border-color:var(--brand);color:var(--brand)}
.chip.active{background:var(--brand);color:#fff;border-color:var(--brand)}
.verdict-cols{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.vcol h3{font-size:13px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.vcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-bottom:10px;box-shadow:var(--shadow);cursor:pointer}
.vcard:hover{box-shadow:var(--shadow-lg);transform:translateY(-1px);transition:.15s}
.vcard .t{font-weight:620}
.vcard .m{font-size:12.5px;color:var(--subtle);margin-top:3px}
.meter{height:6px;border-radius:4px;background:var(--line);margin-top:9px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--brand),var(--brand-2))}
.muted{color:var(--subtle)} .small{font-size:12.5px}
/* drawer */
.scrim{position:fixed;inset:0;background:rgba(10,37,64,.34);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:.2s;z-index:40}
.scrim.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100%;width:430px;max-width:92vw;background:#fff;box-shadow:var(--shadow-lg);transform:translateX(102%);transition:transform .26s cubic-bezier(.22,1,.36,1);z-index:50;overflow:auto}
.drawer.open{transform:none}
.drawer .dh{padding:22px 22px 16px;border-bottom:1px solid var(--line)}
.drawer .dh .x{float:right;cursor:pointer;color:var(--subtle);font-size:20px;line-height:1}
.drawer .dc{padding:18px 22px}
.rec{display:flex;gap:9px;padding:10px 0;border-top:1px solid var(--line);font-size:13.5px}
.pri{font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:5px;height:fit-content}
.pri.high{color:var(--red);background:var(--red-bg)} .pri.medium{color:var(--amber);background:var(--amber-bg)} .pri.low{color:var(--slate);background:var(--slate-bg)}
.kv{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.kv .muted{color:var(--subtle)}
@media(max-width:840px){.cards{grid-template-columns:repeat(2,1fr)}.verdict-cols{grid-template-columns:1fr}}
</style></head>
<body>
<header><div class="bar">
  <div class="logo"><span class="dot"></span>ShopGraph</div>
  <nav id="nav">
    <button data-tab="overview" class="active">Overview</button>
    <button data-tab="predict">Predict</button>
    <button data-tab="products">Products</button>
    <button data-tab="opps">Opportunities</button>
  </nav>
  <div class="spacer"></div>
  <span class="pill" id="feedpill"></span>
</div></header>

<main>
  <section id="overview" class="tab active"></section>
  <section id="predict" class="tab"></section>
  <section id="products" class="tab"></section>
  <section id="opps" class="tab"></section>
</main>

<div class="scrim" id="scrim" onclick="closeDrawer()"></div>
<aside class="drawer" id="drawer"></aside>

<script id="data" type="application/json">${dataJson}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const R = DATA.report, S = R.summary;
const money = n => '$' + Math.round(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const scoreCls = n => n>=75?'s-good':n>=45?'s-warn':'s-bad';
const vBadge = v => '<span class="badge b-'+v+'"><span class="dot-s" style="background:currentColor"></span>'+v+'</span>';
document.getElementById('feedpill').textContent = DATA.feedFile + ' · ' + S.products + ' products';

/* ---- Overview ---- */
const total = S.coverage.well + S.coverage.weak + S.coverage.gap || 1;
const pct = n => Math.round(n/total*100);
document.getElementById('overview').innerHTML = \`
  <h1>Feed overview</h1>
  <div class="sub">How your catalog matches shopper demand today — and the upside from fixing it.</div>
  <div class="cards">
    <div class="card kpi"><div class="k">Avg feed score</div><div class="v">\${S.avgFeedScore}<small>/100</small></div><div class="d">\${S.compliance.atRisk} at disapproval risk</div></div>
    <div class="card kpi"><div class="k">Well-covered</div><div class="v">\${S.coverage.well}<small>/\${total}</small></div><div class="d">\${pct(S.coverage.well)}% of tracked queries</div></div>
    <div class="card kpi"><div class="k">Revenue opportunity</div><div class="v up">\${money(S.revenue.totalMonthly)}<small>/mo</small></div><div class="d">\${money(S.revenue.totalAnnual)}/yr from fixes</div></div>
    <div class="card kpi"><div class="k">Lift from fixes</div><div class="v up">+\${S.estimatedLift.coverageGain}<small> queries</small></div><div class="d">\${S.estimatedLift.queriesFixed} newly fixable</div></div>
  </div>
  <div class="section"><h2>Coverage</h2><div class="body">
    <div class="cov">
      \${pct(S.coverage.well)>0?'<span class="well" style="width:'+pct(S.coverage.well)+'%">'+S.coverage.well+'</span>':''}
      \${pct(S.coverage.weak)>0?'<span class="weak" style="width:'+pct(S.coverage.weak)+'%">'+S.coverage.weak+'</span>':''}
      \${pct(S.coverage.gap)>0?'<span class="gap" style="width:'+pct(S.coverage.gap)+'%">'+S.coverage.gap+'</span>':''}
    </div>
    <div class="legend"><b>\${S.coverage.well}</b> well-covered · <b>\${S.coverage.weak}</b> weak · <b>\${S.coverage.gap}</b> gaps.
      Applying every fix lifts well-covered <b>\${S.estimatedLift.wellBefore} → \${S.estimatedLift.wellAfter}</b>.</div>
  </div></div>
  <div class="section"><h2>Top opportunities</h2>
    <table><thead><tr><th></th><th>Query</th><th>Status</th><th class="r">Value</th><th class="r">Match before → after</th></tr></thead>
    <tbody>\${R.gaps.slice(0,8).map(g=>\`<tr onclick="showQuery('\${esc(g.query)}')">
      <td>\${g.wouldFix?'<span class="up" style="font-weight:700">✓</span>':''}</td>
      <td style="font-weight:600">\${esc(g.query)}</td>
      <td><span class="badge b-\${g.bucket==='weak'?'borderline':'absent'}">\${g.bucket}</span></td>
      <td class="r num">\${Math.round(g.value)}</td>
      <td class="r num">\${g.bestScore} → <b>\${g.afterScore}</b></td></tr>\`).join('')}</tbody></table>
  </div>\`;

/* ---- Predict ---- */
let activeQ = DATA.predictions[0].query;
function renderPredict(){
  const P = DATA.predictions.find(p=>p.query===activeQ) || DATA.predictions[0];
  const group = v => P.rows.filter(r=>r.verdict===v);
  const card = r => \`<div class="vcard" onclick="showProduct('\${r.id}')">
      <div class="t">\${esc(r.title)}</div>
      <div class="m">\${r.id} · relevance \${r.relevance}\${r.rank?' · rank #'+r.rank:''}\${r.eligibilityIssues.length?' · '+esc(r.eligibilityIssues.join(', ')):''}</div>
      <div class="meter"><i style="width:\${Math.round((r.probability||r.relevance)*100)}%"></i></div></div>\`;
  const col = (title,v,clr) => \`<div class="vcol"><h3><span class="dot-s" style="background:\${clr}"></span>\${title} (\${group(v).length})</h3>\${group(v).map(card).join('')||'<div class="small muted" style="padding:8px 2px">None</div>'}</div>\`;
  document.getElementById('predict').innerHTML = \`
    <h1>Will my products appear?</h1>
    <div class="sub">Pick or type a search term to see which products would show — and why.</div>
    <div class="search"><span class="ic">🔍</span><input id="q" placeholder="Search a term…" value="\${esc(activeQ)}" autocomplete="off"></div>
    <div class="chips" id="chips">\${DATA.predictions.map(p=>\`<span class="chip \${p.query===activeQ?'active':''}" onclick="pick('\${esc(p.query)}')">\${esc(p.query)}</span>\`).join('')}</div>
    <div class="muted small" style="margin:-8px 0 16px">Inferred aisle: \${P.aisle?esc(P.aisle):'(none)'} · appear bar 0.45</div>
    <div class="verdict-cols">
      <div>\${col('Would appear','appears','var(--green)')}\${col('Borderline','borderline','#f0b429')}</div>
      <div>\${col('Ineligible — can\\'t serve','ineligible','var(--red)')}\${col("Won't appear",'absent','var(--slate)')}</div>
    </div>\`;
  const inp=document.getElementById('q');
  inp.addEventListener('input',()=>{
    const v=inp.value.toLowerCase().trim();
    const hit=DATA.predictions.find(p=>p.query.toLowerCase().includes(v));
    document.querySelectorAll('#chips .chip').forEach(c=>c.style.display=(!v||c.textContent.toLowerCase().includes(v))?'':'none');
    if(hit) inp.dataset.hit=hit.query;
  });
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&inp.dataset.hit){pick(inp.dataset.hit);}});
}
function pick(q){activeQ=q;renderPredict();}
function showQuery(q){const p=DATA.predictions.find(x=>x.query.toLowerCase()===q.toLowerCase());if(p){activeQ=p.query;show('predict');renderPredict();}else{show('predict');}}

/* ---- Products ---- */
document.getElementById('products').innerHTML = \`
  <h1>Products</h1><div class="sub">Per-product feed health, coverage lift, price position and policy risk. Click a row.</div>
  <div class="section"><table>
    <thead><tr><th>Score</th><th>Product</th><th class="r">Coverage</th><th>Price</th><th>Status</th></tr></thead>
    <tbody>\${R.products.map(p=>\`<tr onclick="showProduct('\${p.id}')">
      <td><span class="score \${scoreCls(p.feedScore)}">\${p.feedScore}</span></td>
      <td><div style="font-weight:600">\${esc(p.title||p.id)}</div><div class="small muted">\${p.id}</div></td>
      <td class="r num">\${p.simulation.beforeCovered} → <b>\${p.simulation.afterCovered}</b></td>
      <td>\${p.price.position==='above'?'<span class="flag">+'+Math.round((p.price.ratioToMedian-1)*100)+'% vs mkt</span>':'<span class="small muted">'+p.price.position+'</span>'}</td>
      <td>\${p.compliance.willLikelyDisapprove?'<span class="flag">disapproval risk</span>':'<span class="small" style="color:var(--green)">ok</span>'}</td></tr>\`).join('')}</tbody>
  </table></div>\`;

/* ---- Opportunities ---- */
document.getElementById('opps').innerHTML = \`
  <h1>Opportunities</h1><div class="sub">Every tracked query not strongly covered, ranked. ✓ = a recommended fix would newly cover it.</div>
  <div class="section"><table>
    <thead><tr><th></th><th>Query</th><th>Status</th><th>Source</th><th class="r">Value</th><th class="r">Before → after</th></tr></thead>
    <tbody>\${R.gaps.map(g=>\`<tr onclick="showQuery('\${esc(g.query)}')">
      <td>\${g.wouldFix?'<span class="up" style="font-weight:700">✓</span>':''}</td>
      <td style="font-weight:600">\${esc(g.query)}</td>
      <td><span class="badge b-\${g.bucket==='weak'?'borderline':'absent'}">\${g.bucket}</span></td>
      <td><span class="small muted">\${g.source}</span></td>
      <td class="r num">\${Math.round(g.value)}</td>
      <td class="r num">\${g.bestScore} → <b>\${g.afterScore}</b></td></tr>\`).join('')}</tbody>
  </table></div>\`;

/* ---- Drawer ---- */
function showProduct(id){
  const p = R.products.find(x=>x.id===id); if(!p) return;
  const recs = p.recommendations.map(r=>\`<div class="rec"><span class="pri \${r.priority}">\${r.priority}</span><span>\${esc(r.message)}</span></div>\`).join('');
  const issues = (p.compliance.issues||[]).filter(i=>i.severity==='disapproval').map(i=>\`<div class="rec"><span class="pri high">policy</span><span>\${esc(i.message)}</span></div>\`).join('');
  openDrawer(\`
    <div class="dh"><span class="x" onclick="closeDrawer()">✕</span>
      <div style="display:flex;align-items:center;gap:12px"><span class="score \${scoreCls(p.feedScore)}">\${p.feedScore}</span>
      <div><div style="font-weight:700;font-size:16px">\${esc(p.title||p.id)}</div><div class="small muted">\${p.id}</div></div></div></div>
    <div class="dc">
      <div class="kv"><span class="muted">Coverage (this category)</span><span><b>\${p.simulation.beforeCovered} → \${p.simulation.afterCovered}</b> of \${p.simulation.relevantQueries} (+\${p.simulation.newlyCovered})</span></div>
      <div class="kv"><span class="muted">Price position</span><span>\${p.price.position}\${p.price.marketMedian?' (market '+p.price.marketMedian+')':''}</span></div>
      <div class="kv"><span class="muted">Policy</span><span>\${p.compliance.willLikelyDisapprove?'<span style="color:var(--red);font-weight:600">disapproval risk</span>':'<span style="color:var(--green)">eligible</span>'}</span></div>
      \${p.simulation.suggestedTitle?'<div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="muted">Suggested title</span><span style="font-weight:600">'+esc(p.simulation.suggestedTitle)+'</span></div>':''}
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--subtle);margin:18px 0 2px">Recommended fixes</h3>
      \${recs||'<div class="small muted" style="padding:8px 0">No issues — well-built feed.</div>'}\${issues}
    </div>\`);
}
function openDrawer(h){document.getElementById('drawer').innerHTML=h;document.getElementById('drawer').classList.add('open');document.getElementById('scrim').classList.add('open');}
function closeDrawer(){document.getElementById('drawer').classList.remove('open');document.getElementById('scrim').classList.remove('open');}

/* ---- Tabs ---- */
function show(t){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id===t));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));}
document.getElementById('nav').addEventListener('click',e=>{if(e.target.dataset.tab)show(e.target.dataset.tab);});
renderPredict();
</script>
</body></html>`;
}
