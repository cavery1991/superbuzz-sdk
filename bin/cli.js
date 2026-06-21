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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createShoppingSystem } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = resolve(__dirname, '../data/products.enriched.json');

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
`);
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);
  switch (cmd) {
    case 'demo': return cmdDemo();
    case 'search': return cmdSearch(positional, flags);
    case 'parse': return cmdParse(positional);
    case 'classify': return cmdClassify(positional, flags);
    case 'taxonomy': return cmdTaxonomy(positional);
    case 'index': return cmdIndex(positional, flags);
    case undefined:
    case 'help':
    case '--help':
    case '-h': return help();
    default:
      fail(`unknown command "${cmd}"`);
      help();
  }
}

main();
