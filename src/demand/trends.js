/**
 * Demand trends & seasonality — factor search-demand momentum into the query
 * universe so merchants can optimize AHEAD of demand rather than reacting to it.
 *
 * A query-universe entry looks like { query, value, source, categoryId }.
 * A trend row describes a single query's momentum and seasonality:
 *   { query, trend:'rising'|'flat'|'declining', growth:number, seasonalMonths:number[] }
 * where growth is a fraction (0.4 = +40%) and seasonalMonths are 1-12.
 *
 * Trends can be ingested from a JS array (normalized in place) or from a
 * CSV/TSV string, reusing the simple split approach used by the feed ingester.
 */

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Normalize trend input into a clean array of trend rows.
 * Accepts either a JS array of objects (missing fields are defaulted) or a
 * CSV/TSV string with a header containing columns like query, trend, growth,
 * seasonal_months (months as a "|"- or space-separated list, or month names).
 * @param {string|object[]} input
 * @returns {Array<{query:string, trend:'rising'|'flat'|'declining', growth:number, seasonalMonths:number[]}>}
 */
export function ingestTrends(input) {
  const rows = Array.isArray(input) ? input : parseTrendString(input);
  const out = [];
  for (const r of rows) {
    const query = norm(r.query);
    if (!query) continue;
    out.push({
      query,
      trend: normTrend(r.trend),
      growth: normGrowth(r.growth),
      seasonalMonths: normMonths(r.seasonalMonths ?? r.seasonal_months),
    });
  }
  return out;
}

/** Detect delimiter and parse a CSV/TSV trend string to plain objects. */
function parseTrendString(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0], delim).map((h) => h.trim().toLowerCase());

  const col = (...names) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const qi = col('query', 'search term', 'search_term');
  const ti = col('trend', 'momentum');
  const gi = col('growth', 'change', 'delta');
  const si = col('seasonal', 'season', 'month');

  return lines.slice(1).map((line) => {
    const cells = splitLine(line, delim);
    return {
      query: (cells[qi] ?? '').trim().replace(/^"|"$/g, ''),
      trend: (cells[ti] ?? '').trim().replace(/^"|"$/g, ''),
      growth: (cells[gi] ?? '').trim().replace(/^"|"$/g, ''),
      seasonalMonths: (cells[si] ?? '').trim().replace(/^"|"$/g, ''),
    };
  });
}

/**
 * Compute the demand multiplier (≥ 0) for a trend row in a given month.
 * Model: base 1.0; rising → ×(1 + min(growth, 2)); declining → ×max(0.5, 1 + growth)
 * (growth is expected negative for declining); in-season (month ∈ seasonalMonths)
 * → ×1.5. If month is omitted, seasonality is ignored. A missing trendRow → 1.0.
 * @param {{trend?:string, growth?:number, seasonalMonths?:number[]}|null|undefined} trendRow
 * @param {{month?:number}} [opts]
 * @returns {number}
 */
export function demandMultiplier(trendRow, { month } = {}) {
  if (!trendRow) return 1.0;
  let m = 1.0;
  const growth = Number(trendRow.growth) || 0;
  if (trendRow.trend === 'rising') m *= 1 + Math.min(growth, 2);
  else if (trendRow.trend === 'declining') m *= Math.max(0.5, 1 + growth);

  if (month != null && Array.isArray(trendRow.seasonalMonths)
    && trendRow.seasonalMonths.includes(month)) {
    m *= 1.5;
  }
  return Math.max(0, m);
}

/**
 * Apply demand to a query universe, returning a NEW array (input is not mutated).
 * Each entry's `value` is multiplied by the demand multiplier for its matching
 * trend (matched by normalized query) and gains two fields: `demand` (the
 * multiplier, rounded to 3) and `trend` (the trend label, or 'unknown' when no
 * trend matches). Entries without a matching trend keep their value unchanged.
 * @param {Array<{query:string, value:number}>} universe
 * @param {Array<{query:string, trend:string, growth:number, seasonalMonths:number[]}>} trends
 * @param {{month?:number}} [opts]
 * @returns {Array<object>}
 */
export function applyDemandToUniverse(universe, trends, { month } = {}) {
  const byQuery = new Map();
  for (const t of trends) byQuery.set(norm(t.query), t);

  return universe.map((entry) => {
    const match = byQuery.get(norm(entry.query));
    const mult = demandMultiplier(match, { month });
    return {
      ...entry,
      value: (entry.value ?? 0) * mult,
      demand: round3(mult),
      trend: match ? match.trend : 'unknown',
    };
  });
}

/**
 * Rank the demand-applied universe for "optimize ahead of demand": entries whose
 * matched trend is 'rising' OR which are currently in-season, sorted by resulting
 * value descending and capped at `limit`.
 * @param {Array<{query:string, value:number}>} universe
 * @param {Array<{query:string, trend:string, growth:number, seasonalMonths:number[]}>} trends
 * @param {{month?:number, limit?:number}} [opts]
 * @returns {Array<object>}
 */
export function risingOpportunities(universe, trends, { month, limit = 20 } = {}) {
  const byQuery = new Map();
  for (const t of trends) byQuery.set(norm(t.query), t);

  const applied = applyDemandToUniverse(universe, trends, { month });
  return applied
    .filter((entry) => {
      const match = byQuery.get(norm(entry.query));
      if (!match) return false;
      const inSeason = month != null && Array.isArray(match.seasonalMonths)
        && match.seasonalMonths.includes(month);
      return match.trend === 'rising' || inSeason;
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Coerce a raw trend label to one of the allowed values (default 'flat'). */
function normTrend(value) {
  const t = String(value ?? '').toLowerCase().trim();
  if (t === 'rising' || t === 'declining' || t === 'flat') return t;
  return 'flat';
}

/** Coerce a raw growth value to a finite number (default 0). */
function normGrowth(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce seasonal months (array, or "|"/space-separated list, or month names) to number[] 1-12. */
function normMonths(value) {
  if (value == null || value === '') return [];
  const tokens = Array.isArray(value)
    ? value
    : String(value).split(/[|,\s]+/).filter(Boolean);
  const out = [];
  for (const tok of tokens) {
    const t = String(tok).toLowerCase().trim();
    if (!t) continue;
    let m = MONTH_NAMES[t];
    if (m == null) {
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= 12) m = n;
    }
    if (m != null && !out.includes(m)) out.push(m);
  }
  return out;
}

/** Minimal delimiter split that respects quoted fields for the comma case. */
function splitLine(line, delim) {
  if (delim === '\t') return line.split('\t');
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function norm(q) {
  return String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
