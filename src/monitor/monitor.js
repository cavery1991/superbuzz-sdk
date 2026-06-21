/**
 * Feed monitor — turns the one-shot analyzer into a continuous signal.
 *
 * The analyzer (see ../feed/analyzer.js) produces a single point-in-time report.
 * This module lets you sample that report over time and reason about how the feed
 * is moving:
 *
 *   1. snapshot      — distil a report into a compact, JSON-serializable record.
 *   2. diffSnapshots — compare two snapshots (next vs prev) and surface deltas.
 *   3. detectAlerts  — turn a diff into actionable regression alerts.
 *
 * Snapshots capture only what the report provides (per-product feedScore + the
 * summary aggregates), so they stay small and cheap to persist between runs.
 */

/**
 * Distil an analyzer report into a compact, JSON-serializable snapshot.
 *
 * @param {object} report                analyzer report (see analyzeFeed)
 * @param {object} [opts]
 * @param {string} [opts.at]             ISO timestamp; defaults to now
 * @returns {{ at: string, avgFeedScore: number,
 *   coverage: { well: number, weak: number, gap: number },
 *   products: Object<string, { feedScore: number }> }}
 */
export function snapshot(report, { at } = {}) {
  const summary = report?.summary ?? {};
  const coverage = summary.coverage ?? {};
  const products = {};
  for (const p of report?.products ?? []) {
    products[p.id] = { feedScore: p.feedScore };
  }
  return {
    at: at ?? new Date().toISOString(),
    avgFeedScore: summary.avgFeedScore ?? 0,
    coverage: {
      well: coverage.well ?? 0,
      weak: coverage.weak ?? 0,
      gap: coverage.gap ?? 0,
    },
    products,
  };
}

/**
 * Compare two snapshots and report what changed (next relative to prev).
 *
 * Only products that changed score, appeared, or disappeared are included.
 *
 * @param {ReturnType<typeof snapshot>} prev   earlier snapshot
 * @param {ReturnType<typeof snapshot>} next   later snapshot
 * @returns {{ coverageChange: { well: number, weak: number, gap: number },
 *   avgFeedScoreChange: number,
 *   products: { id: string, feedScoreChange: number,
 *     added: boolean, removed: boolean }[] }}
 */
export function diffSnapshots(prev, next) {
  const prevProducts = prev?.products ?? {};
  const nextProducts = next?.products ?? {};
  const ids = new Set([...Object.keys(prevProducts), ...Object.keys(nextProducts)]);

  const products = [];
  for (const id of ids) {
    const before = prevProducts[id];
    const after = nextProducts[id];
    const added = !before && !!after;
    const removed = !!before && !after;
    const feedScoreChange = (after?.feedScore ?? 0) - (before?.feedScore ?? 0);
    if (added || removed || feedScoreChange !== 0) {
      products.push({ id, feedScoreChange, added, removed });
    }
  }

  return {
    coverageChange: {
      well: (next?.coverage?.well ?? 0) - (prev?.coverage?.well ?? 0),
      weak: (next?.coverage?.weak ?? 0) - (prev?.coverage?.weak ?? 0),
      gap: (next?.coverage?.gap ?? 0) - (prev?.coverage?.gap ?? 0),
    },
    avgFeedScoreChange: (next?.avgFeedScore ?? 0) - (prev?.avgFeedScore ?? 0),
    products,
  };
}

/**
 * Turn a snapshot diff into regression alerts.
 *
 * @param {ReturnType<typeof diffSnapshots>} diff
 * @param {object} [opts]
 * @param {number} [opts.feedScoreDrop=10]      drop (avg or per-product) that warns
 * @param {number} [opts.coverageWellDrop=1]    well-coverage drop that is critical
 * @returns {{ level: 'warning'|'critical', code: string, message: string }[]}
 *   alerts, sorted critical first
 */
export function detectAlerts(diff, { feedScoreDrop = 10, coverageWellDrop = 1 } = {}) {
  const alerts = [];

  if ((diff?.avgFeedScoreChange ?? 0) <= -feedScoreDrop) {
    alerts.push({
      level: 'warning',
      code: 'avg_score_drop',
      message: `Average feed score dropped by ${-diff.avgFeedScoreChange}.`,
    });
  }

  if ((diff?.coverageChange?.well ?? 0) <= -coverageWellDrop) {
    alerts.push({
      level: 'critical',
      code: 'coverage_drop',
      message: `Well-covered queries dropped by ${-diff.coverageChange.well}.`,
    });
  }

  for (const p of diff?.products ?? []) {
    if (p.removed) {
      alerts.push({
        level: 'warning',
        code: 'product_removed',
        message: `Product ${p.id} is no longer in the feed.`,
      });
    } else if (p.feedScoreChange <= -feedScoreDrop) {
      alerts.push({
        level: 'warning',
        code: 'product_score_drop',
        message: `Product ${p.id} feed score dropped by ${-p.feedScoreChange}.`,
      });
    }
  }

  return alerts.sort((a, b) => rank(a.level) - rank(b.level));
}

function rank(level) {
  return level === 'critical' ? 0 : 1;
}
