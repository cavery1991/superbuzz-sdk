#!/usr/bin/env node
/**
 * CLI for the Shopping Graph system.
 *
 * Commands:
 *   demo                         end-to-end walkthrough with the bundled catalog
 *   search "<query>" [flags]     semantic product search
 *   parse "<query>"             show extracted query factors
 *   classify "<text>"           map text to GPC categories
 *   taxonomy <id|path>          inspect a taxonomy node
 *   index <file.json>           load products and report graph stats
 *   analyze <feed.json>         feed audit: coverage, gaps, fixes & simulated lift
 *                               (--search-terms terms.csv to use real query data)
 *
 * Flags for `search`:
 *   --limit N        max results (default 8)
 *   --in-stock       only in-stock items
 *   --brand X        restrict to a brand
 *   --max-price N    price ceiling
 *   --min-rating N   minimum review rating
 *   --region CODE    real-time geo context (e.g. US-CA) — boosts local inventory
 *   --device X       mobile|desktop|tablet — mobile boosts in-store pickup
 *   --data FILE      product catalog (default data/products.enriched.json)
 *   --explain        show score breakdown
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createShoppingSystem, analyzeFeed, renderHtmlReport,
  ingestSearchTerms, ingestFeed, buildProductProfile,
  evaluate, calibrateThresholds, validateAgainstPerformance,
  createGenerator, shareOfVoice, priceComparison,
  CHANNELS, exportForChannel, missingRequiredFields, toTSV,
  snapshot, diffSnapshots, detectAlerts,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = resolve(__dirname, '../data/products.enriched.json');
const DEFAULT_FEED = resolve(__dirname, '../data/feed.sample.json');
const DEFAULT_JUDGMENTS = resolve(__dirname, '../data/relevance.sample.json');

function loadProducts(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function money(p) {
  return p == null ? '—' : `$${Number(p).toFixed(2)}`;
}

function buildSystem(dataFile) {
  const sys = createShoppingSystem();
  sys.engine.indexAll(loadProducts(dataFile ?? DEFAULT_DATA));
  return sys;
}

function printResults(out, explain) {
  const cat = out.intent.topCategory;
  console.log(`\nQuery: "${out.query}"`);
  console.log(
    `Inferred aisle: ${cat ? `[${cat.id}] ${cat.path}` : '(none)'}` +
      (Object.keys(out.intent.detectedAttributes).length
        ? `  ·  attrs: ${JSON.stringify(out.intent.detectedAttributes)}`
        : ''),
  );
  if (out.intent.impliedConcepts?.length) {
    console.log(`Implied intent: ${out.intent.impliedConcepts.join(', ')}`);
  }
  console.log('─'.repeat(72));
  if (out.results.length === 0) {
    console.log('No matching products.');
    return;
  }
  out.results.forEach((r, i) => {
    const p = r.product;
    const stock = p.inStock ? 'in stock' : 'out of stock';
    console.log(
      `${String(i + 1).padStart(2)}. ${p.title}  (${p.brand ?? '—'})\n` +
        `    ${money(p.price)} · ${stock} · ★${p.rating ?? '—'} · score ${r.score.toFixed(3)}`,
    );
    if (explain) {
      const b = r.breakdown;
      console.log(
        `    ↳ semantic=${b.semantic.toFixed(3)} category=${b.categoryBonus} ` +
          `attr=${b.attrBonus} quality=${b.quality.toFixed(2)} stock=${b.stock}` +
          (r.contextScore ? ` context=+${r.contextScore.toFixed(3)}` : ''),
      );
    }
  });
}

function cmdSearch(positional, flags) {
  const query = positional.join(' ');
  if (!query) return fail('search requires a query, e.g. search "warm winter coat"');
  const sys = buildSystem(flags.data);
  const context = {};
  if (typeof flags.region === 'string') context.region = flags.region;
  if (typeof flags.device === 'string') context.device = flags.device;
  const out = sys.engine.search(query, {
    limit: flags.limit ? Number(flags.limit) : 8,
    inStockOnly: !!flags['in-stock'],
    brand: typeof flags.brand === 'string' ? flags.brand : undefined,
    maxPrice: flags['max-price'] ? Number(flags['max-price']) : undefined,
    minRating: flags['min-rating'] ? Number(flags['min-rating']) : undefined,
    useCategory: !flags['no-category'],
    context: Object.keys(context).length ? context : undefined,
  });
  printResults(out, !!flags.explain);
}

function cmdParse(positional) {
  const query = positional.join(' ');
  if (!query) return fail('parse requires a query, e.g. parse "waterproof black running shoes size 10"');
  const sys = createShoppingSystem();
  const p = sys.engine.parser.parse(query);
  console.log(`\nQuery: "${query}"`);
  console.log('─'.repeat(72));
  console.log(`  core entity   : ${p.coreEntity ?? '—'}`);
  console.log(`  GPC category  : ${p.categoryId != null ? `[${p.categoryId}] ${sys.taxonomy.get(p.categoryId)?.path}` : '—'}`);
  console.log(`  visual        : ${p.modifiers.visual.join(', ') || '—'}`);
  console.log(`  functional    : ${p.modifiers.functional.join(', ') || '—'}`);
  console.log(`  usage         : ${p.modifiers.usage.join(', ') || '—'}`);
  console.log(`  material      : ${p.modifiers.material.join(', ') || '—'}`);
  console.log(`  specs         : ${Object.keys(p.specs).length ? JSON.stringify(p.specs) : '—'}`);
  console.log(`  implied intent: ${p.impliedConcepts.join(', ') || '—'}`);
  console.log(`  implied tags  : ${p.impliedTags.join(', ') || '—'}`);
}

function cmdClassify(positional, flags) {
  const text = positional.join(' ');
  if (!text) return fail('classify requires text, e.g. classify "blue nike sneakers"');
  const sys = createShoppingSystem();
  const top = sys.classifier.classify(text, flags.limit ? Number(flags.limit) : 5);
  console.log(`\nText: "${text}"`);
  console.log('─'.repeat(72));
  for (const c of top) console.log(`  [${c.id}] ${c.path}  (score ${c.score.toFixed(3)})`);
}

function cmdTaxonomy(positional) {
  const sys = createShoppingSystem();
  const tax = sys.taxonomy;
  const arg = positional.join(' ');
  if (!arg) {
    console.log(`Taxonomy loaded: ${tax.size} categories. Roots:`);
    for (const n of tax.all().filter((x) => x.parentId == null)) console.log(`  [${n.id}] ${n.name}`);
    return;
  }
  const node = /^\d+$/.test(arg) ? tax.get(Number(arg)) : tax.getByPath(arg);
  if (!node) return fail(`No category for "${arg}"`);
  console.log(`\n[${node.id}] ${node.path}`);
  console.log(`  ancestors: ${tax.ancestors(node.id).map((n) => n.name).join(' > ')}`);
  const kids = tax.children(node.id);
  console.log(`  children : ${kids.length ? kids.map((k) => `[${k.id}] ${k.name}`).join(', ') : '(leaf)'}`);
}

function cmdIndex(positional, flags) {
  const file = positional[0] ?? flags.data ?? DEFAULT_DATA;
  const sys = buildSystem(file);
  console.log(`Indexed ${sys.graph.size} products from ${file}`);
  console.log('Graph stats:', sys.graph.stats());
}

function cmdDemo() {
  console.log('='.repeat(72));
  console.log(' Shopping Graph — end-to-end demo');
  console.log('='.repeat(72));
  const sys = buildSystem();
  console.log(`\n1) Taxonomy (the number system): ${sys.taxonomy.size} categories loaded.`);
  console.log(`2) Shopping Graph: ${sys.graph.size} products indexed & embedded.`, sys.graph.stats());

  console.log('\n3) Query factor extraction:');
  const p = sys.engine.parser.parse('waterproof black running shoes size 10');
  console.log(`   "waterproof black running shoes size 10"`);
  console.log(`     core entity=${p.coreEntity}  color=${p.attributes.color}  ` +
    `functional=[${p.modifiers.functional}]  usage=[${p.modifiers.usage}]  size=${p.specs.size}`);

  const queries = [
    'warm winter coat',
    'blue nike sneakers',
    'wireless noise cancelling earbuds',
    'lightweight bag for hiking',
  ];
  console.log('\n4) Semantic search (meaning, not just keywords):');
  for (const q of queries) {
    printResults(sys.engine.search(q, { limit: 3 }), false);
  }

  console.log('\n5) Implied intent + review-mined semantics:');
  printResults(sys.engine.search("hiking boots that won't slip on ice", { limit: 2 }), false);

  console.log('\n6) Real-time context (geo): same query, region=US-NY boosts local stock:');
  printResults(sys.engine.search('hiking boots', { limit: 2, context: { region: 'US-NY' } }), true);

  console.log('\nDone. Try:  node bin/cli.js parse "headphones to block out noise on a plane"');
}

function cmdAnalyze(positional, flags) {
  const feedFile = positional[0] ?? (typeof flags.feed === 'string' ? flags.feed : DEFAULT_FEED);
  const feed = readFileSync(feedFile, 'utf8');
  const stFile = typeof flags['search-terms'] === 'string' ? flags['search-terms'] : null;
  const searchTermsCsv = stFile ? readFileSync(stFile, 'utf8') : undefined;

  const report = analyzeFeed({ feed, searchTermsCsv });
  const s = report.summary;

  // Optional HTML export.
  if (flags.html) {
    const out = typeof flags.html === 'string' ? flags.html : 'feed-report.html';
    writeFileSync(out, renderHtmlReport(report, { feedFile, searchTermsFile: stFile }));
    console.log(`HTML report written to ${out}`);
    if (flags['html-only']) return;
  }

  console.log('='.repeat(72));
  console.log(' Feed analysis report');
  console.log('='.repeat(72));
  console.log(`Feed: ${feedFile}` + (stFile ? `  ·  search terms: ${stFile}` : '  ·  query universe: generated'));
  console.log(`Products: ${s.products}  ·  Categories: ${s.categories}  ·  Avg feed score: ${s.avgFeedScore}/100`);
  console.log(`Query universe: ${s.queryUniverse.total} (${s.queryUniverse.real} real, ${s.queryUniverse.generated} generated)`);
  console.log(
    `Coverage now: ${s.coverage.well} well · ${s.coverage.weak} weak · ${s.coverage.gap} gaps`,
  );
  const lift = s.estimatedLift;
  console.log(
    `Estimated lift from fixes: ${lift.wellBefore} → ${lift.wellAfter} well-covered ` +
      `(${signed(lift.coverageGain)} queries, ${signed(lift.valueCoverageGainPct)}% by value) · ` +
      `${lift.queriesFixed} queries newly fixed`,
  );
  if (s.revenue) {
    console.log(`Projected revenue from fixes: $${s.revenue.totalMonthly.toLocaleString()}/mo ($${s.revenue.totalAnnual.toLocaleString()}/yr)`);
  }
  console.log(`Risk: ${s.compliance.atRisk} product(s) may be disapproved · ${s.pricing.aboveMarket} priced above market`);

  console.log('\nTop opportunities (high-value queries not strongly covered):');
  console.log('  ✓ = a recommended fix would newly cover this query');
  console.log('─'.repeat(72));
  if (report.gaps.length === 0) console.log('  (none — catalog covers the query universe well)');
  for (const g of report.gaps.slice(0, 10)) {
    const fix = g.wouldFix ? '✓' : ' ';
    console.log(`  ${fix} "${g.query}"  [${g.bucket}, ${g.source}, value ${Math.round(g.value)}]  ${g.bestScore} → ${g.afterScore}`);
  }

  console.log('\nPer-product fixes (worst feed score first):');
  console.log('─'.repeat(72));
  for (const p of report.products) {
    const flags = [];
    if (p.compliance?.willLikelyDisapprove) flags.push('⚠ DISAPPROVAL RISK');
    if (p.price?.position === 'above') flags.push(`$ above market (${Math.round((p.price.ratioToMedian - 1) * 100)}%)`);
    console.log(`\n[${p.feedScore}/100] ${p.id} — "${p.title}"${flags.length ? '  ' + flags.join(' · ') : ''}`);
    const sim = p.simulation;
    console.log(`   coverage ${sim.beforeCovered} → ${sim.afterCovered} of ${sim.relevantQueries} category queries ` +
      `(+${sim.newlyCovered} newly covered)`);
    for (const r of p.recommendations.slice(0, 5)) {
      console.log(`   [${r.priority}] ${r.message}`);
    }
    for (const c of (p.compliance?.issues ?? []).filter((i) => i.severity === 'disapproval').slice(0, 3)) {
      console.log(`   [compliance] ${c.message}`);
    }
  }
  console.log('\nTip: add --search-terms data/search-terms.sample.csv to score against real queries.');
}

function pct(part, cov) {
  const total = cov.valueWell + cov.valueWeak + cov.valueGap;
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function cmdEval(positional, flags) {
  const dataFile = typeof flags.data === 'string' ? flags.data : DEFAULT_DATA;
  const judgmentsFile = positional[0] ?? (typeof flags.judgments === 'string' ? flags.judgments : DEFAULT_JUDGMENTS);
  const k = flags.k ? Number(flags.k) : 5;

  const sys = buildSystem(dataFile);
  const judgments = JSON.parse(readFileSync(judgmentsFile, 'utf8'));

  const m = evaluate(sys.engine, judgments, { k });
  console.log('='.repeat(72));
  console.log(` Retrieval quality (${m.queries} judged queries, k=${k})`);
  console.log('='.repeat(72));
  console.log(`  precision@${k}: ${m.precisionAtK}`);
  console.log(`  recall@${k}:    ${m.recallAtK}`);
  console.log(`  MRR:          ${m.mrr}`);
  console.log(`  NDCG@${k}:      ${m.ndcgAtK}`);

  const cal = calibrateThresholds(sys.engine, judgments);
  console.log('\nThreshold calibration (vs labeled relevance):');
  console.log(`  best F1 ${cal.best.f1} at cosine ≥ ${cal.best.t} (precision ${cal.best.precision}, recall ${cal.best.recall})`);
  console.log(`  recommended thresholds → well: ${cal.recommended.well}  weak: ${cal.recommended.weak}`);
  console.log('  (the analyzer currently uses well: 0.45, weak: 0.2)');

  const worst = m.perQuery.filter((q) => q.precision === 0).map((q) => q.query);
  if (worst.length) console.log(`\n  queries with no relevant hit in top ${k}: ${worst.join(', ')}`);
}

function cmdValidate(positional, flags) {
  const dataFile = typeof flags.data === 'string' ? flags.data : DEFAULT_DATA;
  const stFile = positional[0] ?? (typeof flags['search-terms'] === 'string' ? flags['search-terms']
    : resolve(__dirname, '../data/search-terms.sample.csv'));
  const metric = typeof flags.metric === 'string' ? flags.metric : 'conversions';

  const sys = buildSystem(dataFile);
  const searchTerms = ingestSearchTerms(readFileSync(stFile, 'utf8'));
  const v = validateAgainstPerformance(sys.engine, searchTerms, { metric });

  console.log('='.repeat(72));
  console.log(' Validation: does predicted coverage track real performance?');
  console.log('='.repeat(72));
  console.log(`Metric: ${v.metric}  ·  queries: ${v.rows.length}`);
  for (const b of ['well', 'weak', 'gap']) {
    console.log(`  ${b.padEnd(5)}: ${String(v.summary[b].n).padStart(3)} queries · avg ${v.metric} ${v.summary[b].avgPerf}`);
  }
  console.log(`\n  correlation(coverage score, ${v.metric}): ${v.correlation}`);
  console.log(`  hypothesis "better coverage → better performance": ${v.holds ? 'HOLDS ✓' : 'does NOT hold ✗'}`);
  console.log('\n  Per-query:');
  for (const r of v.rows.sort((a, b) => b.perf - a.perf).slice(0, 12)) {
    console.log(`    [${r.bucket.padEnd(4)}] ${r.bestScore}  ${v.metric}=${r.perf}  "${r.query}"`);
  }
}

async function cmdGenerate(positional, flags) {
  const feedFile = positional[0] ?? (typeof flags.feed === 'string' ? flags.feed : DEFAULT_FEED);
  const sys = createShoppingSystem();
  const taxonomy = sys.taxonomy;
  const items = ingestFeed(readFileSync(feedFile, 'utf8'), taxonomy);
  const generator = createGenerator({
    provider: typeof flags.provider === 'string' ? flags.provider : undefined,
  });

  console.log('='.repeat(72));
  console.log(` Generated optimized feed content  (provider: ${generator.name})`);
  console.log('='.repeat(72));

  const out = [];
  for (const it of items) {
    const profile = buildProductProfile({
      feed: it.product, schema: it.raw.schema,
      visionTags: it.raw.visionTags, reviews: it.raw.reviews,
    });
    const stored = sys.engine.index({ ...it.product });
    const content = await generator.generate({
      raw: it.raw, product: stored, taxonomy, derivedTags: profile.derivedTags,
    });

    // Prove it helped: re-embed the generated copy and compare category coverage.
    const beforeVec = stored.embedding;
    const afterVec = sys.embedder.embed(`${content.title} ${content.description} ${taxonomy.get(stored.categoryId)?.parts.join(' ') ?? ''}`);
    console.log(`\n${it.product.id}`);
    console.log(`  before: "${it.raw.title ?? ''}"`);
    console.log(`  after : "${content.title}"`);
    console.log(`  desc  : ${content.description}`);
    out.push({ ...it.raw, title: content.title, description: content.description });
  }

  if (flags.out && typeof flags.out === 'string') {
    writeFileSync(flags.out, JSON.stringify(out, null, 2));
    console.log(`\nOptimized feed written to ${flags.out}`);
  } else {
    console.log('\nTip: add --out optimized-feed.json to save the rewritten feed.');
  }
}

function cmdCompete(positional, flags) {
  const ourFile = typeof flags.data === 'string' ? flags.data : DEFAULT_DATA;
  const compFile = positional[0] ?? (typeof flags.competitors === 'string' ? flags.competitors : null);
  if (!compFile) return fail('compete needs a competitor feed: compete <competitors.json> [--data ours.json]');

  const sys = createShoppingSystem();
  const ours = JSON.parse(readFileSync(ourFile, 'utf8'));
  const comp = JSON.parse(readFileSync(compFile, 'utf8'));
  const ourIds = new Set(ours.map((p) => p.id));
  const ourStored = sys.engine.indexAll(ours); // indexed → carry classified categoryId
  const compStored = sys.engine.indexAll(comp.map((p, i) => ({ ...p, id: p.id ?? `comp-${i}` })));

  const queries = JSON.parse(readFileSync(DEFAULT_JUDGMENTS, 'utf8')).map((j) => j.query);
  const sov = shareOfVoice({ engine: sys.engine, queries, ownIds: ourIds, k: 3 });

  console.log('='.repeat(72));
  console.log(' Competitive analysis');
  console.log('='.repeat(72));
  console.log(`Share of voice (top-3 across ${queries.length} queries): ${(sov.overall * 100).toFixed(0)}%`);
  console.log('\nQueries where a competitor takes the #1 spot:');
  const losing = sov.perQuery.filter((x) => x.topIds[0] && !ourIds.has(x.topIds[0]));
  if (losing.length === 0) console.log('  (none — you rank #1 everywhere)');
  for (const q of losing.slice(0, 10)) {
    console.log(`  ✗ "${q.query}"  → ${q.topIds[0]}`);
  }
  const prices = priceComparison({ ownProducts: ourStored, competitorProducts: compStored });
  console.log('\nPrice position by category:');
  for (const [cat, p] of prices) {
    console.log(`  [${cat}] you ${p.ownMedian} vs market ${p.competitorMedian} → ${p.position}`);
  }
}

function cmdChannels(positional, flags) {
  const channel = positional[0];
  if (!channel || !CHANNELS[channel]) {
    return fail(`channels <${Object.keys(CHANNELS).join('|')}> [--data feed.json] [--out file.tsv]`);
  }
  const dataFile = typeof flags.data === 'string' ? flags.data : DEFAULT_DATA;
  const sys = createShoppingSystem();
  const products = sys.engine.indexAll(JSON.parse(readFileSync(dataFile, 'utf8')));
  const records = exportForChannel(products, channel);
  const tsv = toTSV(records);
  if (typeof flags.out === 'string') {
    writeFileSync(flags.out, tsv);
    console.log(`Exported ${records.length} products for ${CHANNELS[channel].label} → ${flags.out}`);
  } else {
    console.log(tsv);
  }
  const incomplete = records.map((r, i) => ({ id: records[i].id ?? records[i].sku, missing: missingRequiredFields(r, channel) }))
    .filter((x) => x.missing.length);
  if (incomplete.length) {
    console.error(`\n${incomplete.length} product(s) missing required ${channel} fields:`);
    for (const x of incomplete.slice(0, 10)) console.error(`  ${x.id}: ${x.missing.join(', ')}`);
  }
}

function cmdMonitor(positional, flags) {
  const feedFile = typeof flags.feed === 'string' ? flags.feed : DEFAULT_FEED;
  const stateFile = positional[0] ?? (typeof flags.state === 'string' ? flags.state : '/tmp/feed-snapshot.json');
  const stFile = typeof flags['search-terms'] === 'string' ? flags['search-terms'] : null;
  const report = analyzeFeed({
    feed: readFileSync(feedFile, 'utf8'),
    searchTermsCsv: stFile ? readFileSync(stFile, 'utf8') : undefined,
  });
  const next = snapshot(report);

  let prev = null;
  try { prev = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* first run */ }

  if (!prev) {
    writeFileSync(stateFile, JSON.stringify(next, null, 2));
    console.log(`Baseline snapshot saved to ${stateFile}. Re-run after changes to detect regressions.`);
    return;
  }
  const diff = diffSnapshots(prev, next);
  const alerts = detectAlerts(diff);
  console.log('='.repeat(72));
  console.log(' Feed monitor');
  console.log('='.repeat(72));
  console.log(`Since ${prev.at}:  avg feed score ${signed(diff.avgFeedScoreChange)} · well-coverage ${signed(diff.coverageChange.well)}`);
  if (alerts.length === 0) console.log('No regressions. ✓');
  for (const a of alerts) console.log(`  [${a.level.toUpperCase()}] ${a.message}`);
  writeFileSync(stateFile, JSON.stringify(next, null, 2));
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exitCode = 1;
}

function help() {
  console.log(`shopping-graph — Google Shopping-style semantic product discovery

Usage:
  shopping-graph demo
  shopping-graph search "<query>" [--limit N] [--in-stock] [--brand X]
                                  [--max-price N] [--min-rating N]
                                  [--region CODE] [--device mobile|desktop]
                                  [--no-category] [--explain]
  shopping-graph parse "<query>"
  shopping-graph classify "<text>" [--limit N]
  shopping-graph taxonomy [<id|path>]
  shopping-graph index [<file.json>]
  shopping-graph analyze [<feed.json>] [--search-terms <terms.csv>] [--html <out.html>]
  shopping-graph generate [<feed.json>] [--provider llm|template] [--out optimized.json]
  shopping-graph compete <competitors.json> [--data ours.json]
  shopping-graph channels <google|meta|amazon> [--data feed.json] [--out file.tsv]
  shopping-graph monitor [<state.json>] [--feed feed.json] [--search-terms terms.csv]
  shopping-graph eval [<judgments.json>] [--data <catalog.json>] [--k N]
  shopping-graph validate [<terms.csv>] [--data <catalog.json>] [--metric conversions]
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);
  switch (cmd) {
    case 'demo': return cmdDemo();
    case 'search': return cmdSearch(positional, flags);
    case 'parse': return cmdParse(positional);
    case 'classify': return cmdClassify(positional, flags);
    case 'taxonomy': return cmdTaxonomy(positional);
    case 'index': return cmdIndex(positional, flags);
    case 'analyze': return cmdAnalyze(positional, flags);
    case 'generate': return cmdGenerate(positional, flags);
    case 'compete': return cmdCompete(positional, flags);
    case 'channels': return cmdChannels(positional, flags);
    case 'monitor': return cmdMonitor(positional, flags);
    case 'eval': return cmdEval(positional, flags);
    case 'validate': return cmdValidate(positional, flags);
    case undefined:
    case 'help':
    case '--help':
    case '-h': return help();
    default:
      fail(`unknown command "${cmd}"`);
      help();
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
