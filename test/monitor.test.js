/**
 * Tests for the feed monitor. Builds synthetic analyzer reports (plain objects
 * matching the analyzeFeed shape), snapshots them, diffs the snapshots, and
 * asserts the regression alerts that come out the other side.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { snapshot, diffSnapshots, detectAlerts } from '../src/monitor/monitor.js';

/** A synthetic analyzer report (only the fields the monitor reads). */
function makeReport({ avgFeedScore, coverage, products }) {
  return {
    summary: { products: products.length, avgFeedScore, coverage },
    products,
    gaps: [],
  };
}

test('detectAlerts: score drop, coverage drop, and removed product', () => {
  const prev = makeReport({
    avgFeedScore: 80,
    coverage: { well: 10, weak: 3, gap: 2 },
    products: [
      { id: 'A', title: 'Alpha', feedScore: 90 },
      { id: 'B', title: 'Bravo', feedScore: 70 },
      { id: 'C', title: 'Charlie', feedScore: 60 },
    ],
  });
  const next = makeReport({
    avgFeedScore: 70,
    coverage: { well: 8, weak: 4, gap: 3 }, // well -2
    products: [
      { id: 'A', title: 'Alpha', feedScore: 90 },     // unchanged
      { id: 'B', title: 'Bravo', feedScore: 50 },     // dropped 20
      // C removed
    ],
  });

  const prevSnap = snapshot(prev, { at: '2026-06-20T00:00:00.000Z' });
  const nextSnap = snapshot(next, { at: '2026-06-21T00:00:00.000Z' });
  const diff = diffSnapshots(prevSnap, nextSnap);
  const alerts = detectAlerts(diff);

  const codes = alerts.map((a) => a.code);
  assert.ok(codes.includes('product_score_drop'), 'expected product_score_drop');
  assert.ok(codes.includes('coverage_drop'), 'expected coverage_drop');
  assert.ok(codes.includes('product_removed'), 'expected product_removed');

  const coverageAlert = alerts.find((a) => a.code === 'coverage_drop');
  assert.equal(coverageAlert.level, 'critical');

  const scoreDrop = alerts.find((a) => a.code === 'product_score_drop');
  assert.equal(scoreDrop.level, 'warning');
  assert.ok(scoreDrop.message.includes('B'), 'message should name the product id');

  const removed = alerts.find((a) => a.code === 'product_removed');
  assert.ok(removed.message.includes('C'), 'message should name the removed id');

  // Critical alerts must sort first.
  assert.equal(alerts[0].level, 'critical');
});

test('detectAlerts: improved/unchanged catalog yields no alerts', () => {
  const prev = makeReport({
    avgFeedScore: 70,
    coverage: { well: 8, weak: 4, gap: 3 },
    products: [
      { id: 'A', title: 'Alpha', feedScore: 70 },
      { id: 'B', title: 'Bravo', feedScore: 60 },
    ],
  });
  const next = makeReport({
    avgFeedScore: 85,
    coverage: { well: 11, weak: 2, gap: 1 }, // well improved
    products: [
      { id: 'A', title: 'Alpha', feedScore: 90 }, // improved
      { id: 'B', title: 'Bravo', feedScore: 60 }, // unchanged
    ],
  });

  const diff = diffSnapshots(snapshot(prev), snapshot(next));
  const alerts = detectAlerts(diff);
  assert.deepEqual(alerts, []);
});

test('snapshot: JSON round-trippable', () => {
  const report = makeReport({
    avgFeedScore: 77,
    coverage: { well: 5, weak: 2, gap: 1 },
    products: [
      { id: 'A', title: 'Alpha', feedScore: 88 },
      { id: 'B', title: 'Bravo', feedScore: 55 },
    ],
  });
  const snap = snapshot(report, { at: '2026-06-21T12:00:00.000Z' });
  const roundTripped = JSON.parse(JSON.stringify(snap));
  assert.deepEqual(roundTripped, snap);
});
