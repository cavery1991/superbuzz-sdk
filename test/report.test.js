import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { analyzeFeed, renderHtmlReport } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(resolve(__dirname, '../data/feed.sample.json'), 'utf8');
const TERMS = readFileSync(resolve(__dirname, '../data/search-terms.sample.csv'), 'utf8');

test('renderHtmlReport produces a complete HTML document with key data', () => {
  const report = analyzeFeed({ feed: FEED, searchTermsCsv: TERMS });
  const html = renderHtmlReport(report, { feedFile: 'feed.json' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Feed Analysis Report/);
  assert.ok(html.includes(`${report.summary.products}`));
  // includes a product id and a recommendation
  assert.ok(html.includes('SKU-1004'));
  assert.match(html, /Top opportunities/);
});

test('renderHtmlReport escapes HTML in product/query text', () => {
  const feed = JSON.stringify([
    { id: 'x1', title: 'Coat <script>alert(1)</script>', description: 'warm', price: '10 USD', availability: 'in_stock', brand: 'A & B' },
  ]);
  const report = analyzeFeed({ feed });
  const html = renderHtmlReport(report);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
