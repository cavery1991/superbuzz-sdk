import { useState, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, Minus, Link2 } from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import MetricCard from '@/components/ui/MetricCard';
import LoadingState from '@/components/ui/LoadingState';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';
import { useDateRange } from '@/hooks/useApi';
import {
  fetchBrandVsNonbrand,
  fetchDailyMetrics,
  fetchSearchTermCoverage,
} from '@/services/api';
import {
  formatCurrency,
  formatPercent,
  formatRoas,
  formatNumber,
  formatCompactNumber,
} from '@/utils/format';
import type {
  BrandVsNonbrand,
  DailyMetric,
  SearchTermCoverage,
} from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_BRAND: BrandVsNonbrand = {
  brand_spend: 16940,
  nonbrand_spend: 25410,
  brand_revenue: 93210,
  nonbrand_revenue: 93210,
  brand_roas: 5.5,
  nonbrand_roas: 3.67,
  brand_cpa: 18.2,
  nonbrand_cpa: 38.8,
  brand_cvr: 6.2,
  nonbrand_cvr: 3.1,
  brand_new_customer_pct: 12,
  nonbrand_new_customer_pct: 56,
  brand_marginal_roas: 1.2,
  nonbrand_marginal_roas: 3.9,
  brand_spend_pct: 40,
  nonbrand_spend_pct: 60,
  brand_revenue_pct: 50,
  nonbrand_revenue_pct: 50,
};

function generateDemoDaily(): DailyMetric[] {
  const days: DailyMetric[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const bSpend = 450 + Math.random() * 200;
    const nbSpend = 700 + Math.random() * 300;
    const bRev = bSpend * (4.5 + Math.random() * 2);
    const nbRev = nbSpend * (3 + Math.random() * 1.5);
    days.push({
      date: d.toISOString().split('T')[0],
      revenue: Math.round(bRev + nbRev),
      spend: Math.round(bSpend + nbSpend),
      roas: +((bRev + nbRev) / (bSpend + nbSpend)).toFixed(2),
      brand_spend: Math.round(bSpend),
      nonbrand_spend: Math.round(nbSpend),
      brand_revenue: Math.round(bRev),
      nonbrand_revenue: Math.round(nbRev),
      new_customers: Math.round(8 + Math.random() * 20),
      cpa: +((bSpend + nbSpend) / (8 + Math.random() * 20)).toFixed(2),
      organic_traffic: Math.round(800 + Math.random() * 400),
      paid_brand_traffic: Math.round(300 + Math.random() * 200),
    });
  }
  return days;
}

const DEMO_DAILY = generateDemoDaily();

const DEMO_COVERAGE: SearchTermCoverage = {
  total_terms: 2847,
  classified_terms: 2534,
  unclassified_terms: 313,
  coverage_pct: 89,
  brand_terms: 823,
  nonbrand_terms: 1584,
  competitor_terms: 127,
  uncertain_terms: [
    { term: 'best workout supplement', suggested: 'nonbrand', confidence: 0.82 },
    { term: 'superbuzz pre workout', suggested: 'brand', confidence: 0.91 },
    { term: 'gym energy drink near me', suggested: 'nonbrand', confidence: 0.76 },
    { term: 'superbuzz vs competitor x', suggested: 'competitor', confidence: 0.68 },
    { term: 'natural pre workout powder', suggested: 'nonbrand', confidence: 0.88 },
  ],
};

const PIE_COLORS = ['#3399FF', '#10B981', '#F59E0B'];

// ──────────────────────────────── Helpers ────────────────────────────────

interface CompRow {
  metric: string;
  brand: string;
  nonbrand: string;
  delta: number;
  context: string;
}

function buildComparisonRows(data: BrandVsNonbrand): CompRow[] {
  return [
    {
      metric: 'Spend',
      brand: formatCurrency(data.brand_spend),
      nonbrand: formatCurrency(data.nonbrand_spend),
      delta: data.brand_spend_pct - 50,
      context: `${formatPercent(data.brand_spend_pct, 0)} / ${formatPercent(data.nonbrand_spend_pct, 0)}`,
    },
    {
      metric: 'Revenue',
      brand: formatCurrency(data.brand_revenue),
      nonbrand: formatCurrency(data.nonbrand_revenue),
      delta: data.brand_revenue_pct - 50,
      context: `${formatPercent(data.brand_revenue_pct, 0)} / ${formatPercent(data.nonbrand_revenue_pct, 0)}`,
    },
    {
      metric: 'ROAS',
      brand: formatRoas(data.brand_roas),
      nonbrand: formatRoas(data.nonbrand_roas),
      delta: ((data.brand_roas - data.nonbrand_roas) / data.nonbrand_roas) * 100,
      context: 'Brand is higher (expected)',
    },
    {
      metric: 'CPA',
      brand: formatCurrency(data.brand_cpa),
      nonbrand: formatCurrency(data.nonbrand_cpa),
      delta: ((data.brand_cpa - data.nonbrand_cpa) / data.nonbrand_cpa) * 100,
      context: 'Lower is better',
    },
    {
      metric: 'CVR',
      brand: formatPercent(data.brand_cvr),
      nonbrand: formatPercent(data.nonbrand_cvr),
      delta: ((data.brand_cvr - data.nonbrand_cvr) / data.nonbrand_cvr) * 100,
      context: '',
    },
    {
      metric: 'New Customer %',
      brand: formatPercent(data.brand_new_customer_pct),
      nonbrand: formatPercent(data.nonbrand_new_customer_pct),
      delta: data.brand_new_customer_pct - data.nonbrand_new_customer_pct,
      context: 'Non-brand drives new customers',
    },
    {
      metric: 'Marginal ROAS',
      brand: formatRoas(data.brand_marginal_roas),
      nonbrand: formatRoas(data.nonbrand_marginal_roas),
      delta: ((data.brand_marginal_roas - data.nonbrand_marginal_roas) / data.nonbrand_marginal_roas) * 100,
      context: 'Key decision metric',
    },
  ];
}

function TrendIndicator({ value }: { value: number }) {
  if (value > 0) return <ArrowUpRight className="w-4 h-4 text-emerald-500" />;
  if (value < 0) return <ArrowDownRight className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

// ──────────────────────────────── Component ────────────────────────────────

export default function BrandNonbrandPage() {
  const { dateRange, preset, setPreset } = useDateRange('30d');

  const [brandData, setBrandData] = useState<BrandVsNonbrand>(DEMO_BRAND);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>(DEMO_DAILY);
  const [coverage, setCoverage] = useState<SearchTermCoverage>(DEMO_COVERAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      fetchBrandVsNonbrand(dateRange),
      fetchDailyMetrics(dateRange),
      fetchSearchTermCoverage(),
    ]).then((results) => {
      if (cancelled) return;
      const [brR, dmR, cvR] = results;
      if (brR.status === 'fulfilled') setBrandData(brR.value);
      if (dmR.status === 'fulfilled' && dmR.value.length > 0) setDailyMetrics(dmR.value);
      if (cvR.status === 'fulfilled') setCoverage(cvR.value);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [dateRange]);

  if (loading) {
    return (
      <PageLayout title="Brand vs Non-brand" subtitle="Understand your brand/non-brand spend dynamics">
        <LoadingState variant="cards" count={4} />
      </PageLayout>
    );
  }

  const compRows = buildComparisonRows(brandData);

  const trendData = dailyMetrics.map((d) => ({
    date: d.date.slice(5),
    'Brand Spend': d.brand_spend,
    'Non-brand Spend': d.nonbrand_spend,
    'Brand Revenue': d.brand_revenue,
    'Non-brand Revenue': d.nonbrand_revenue,
  }));

  // Weekly aggregation for WoW trend
  const lastWeek = dailyMetrics.slice(-7);
  const prevWeek = dailyMetrics.slice(-14, -7);
  const lwBrandSpend = lastWeek.reduce((s, d) => s + d.brand_spend, 0);
  const pwBrandSpend = prevWeek.reduce((s, d) => s + d.brand_spend, 0);
  const lwNbSpend = lastWeek.reduce((s, d) => s + d.nonbrand_spend, 0);
  const pwNbSpend = prevWeek.reduce((s, d) => s + d.nonbrand_spend, 0);
  const lwBrandRev = lastWeek.reduce((s, d) => s + d.brand_revenue, 0);
  const pwBrandRev = prevWeek.reduce((s, d) => s + d.brand_revenue, 0);
  const lwNbRev = lastWeek.reduce((s, d) => s + d.nonbrand_revenue, 0);
  const pwNbRev = prevWeek.reduce((s, d) => s + d.nonbrand_revenue, 0);

  const wowChanges = {
    brandSpend: pwBrandSpend > 0 ? ((lwBrandSpend - pwBrandSpend) / pwBrandSpend) * 100 : 0,
    nbSpend: pwNbSpend > 0 ? ((lwNbSpend - pwNbSpend) / pwNbSpend) * 100 : 0,
    brandRev: pwBrandRev > 0 ? ((lwBrandRev - pwBrandRev) / pwBrandRev) * 100 : 0,
    nbRev: pwNbRev > 0 ? ((lwNbRev - pwNbRev) / pwNbRev) * 100 : 0,
  };

  const coveragePieData = [
    { name: 'Brand', value: coverage.brand_terms },
    { name: 'Non-brand', value: coverage.nonbrand_terms },
    { name: 'Competitor', value: coverage.competitor_terms },
  ];

  return (
    <PageLayout
      title="Brand vs Non-brand"
      subtitle="Understand your brand/non-brand spend dynamics"
      showDateRange
      preset={preset}
      onPresetChange={setPreset}
    >
      {/* Split Summary */}
      <section>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Brand Spend"
            value={formatCompactNumber(brandData.brand_spend)}
            prefix="$"
            change={wowChanges.brandSpend}
            changeLabel="WoW"
          />
          <MetricCard
            label="Non-brand Spend"
            value={formatCompactNumber(brandData.nonbrand_spend)}
            prefix="$"
            change={wowChanges.nbSpend}
            changeLabel="WoW"
          />
          <MetricCard
            label="Brand Revenue"
            value={formatCompactNumber(brandData.brand_revenue)}
            prefix="$"
            change={wowChanges.brandRev}
            changeLabel="WoW"
          />
          <MetricCard
            label="Non-brand Revenue"
            value={formatCompactNumber(brandData.nonbrand_revenue)}
            prefix="$"
            change={wowChanges.nbRev}
            changeLabel="WoW"
          />
        </div>
      </section>

      {/* Time Series Comparison */}
      <section className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Spend & Revenue Over Time</h3>
        <TimeSeriesChart
          data={trendData}
          xKey="date"
          lines={[
            { dataKey: 'Brand Spend', name: 'Brand Spend', color: '#3399FF' },
            { dataKey: 'Non-brand Spend', name: 'Non-brand Spend', color: '#10B981' },
            { dataKey: 'Brand Revenue', name: 'Brand Revenue', color: '#85C2FF', strokeDasharray: '5 5' },
            { dataKey: 'Non-brand Revenue', name: 'Non-brand Revenue', color: '#6EE7B7', strokeDasharray: '5 5' },
          ]}
          height={320}
        />
      </section>

      {/* Performance Table */}
      <section className="card">
        <div className="card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Performance Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Metric
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-blue-600 uppercase tracking-wide">
                  Brand
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-emerald-600 uppercase tracking-wide">
                  Non-brand
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Delta
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Context
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {compRows.map((row) => (
                <tr key={row.metric} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 font-medium text-gray-900">{row.metric}</td>
                  <td className="px-6 py-3 text-right font-semibold text-gray-800">{row.brand}</td>
                  <td className="px-6 py-3 text-right font-semibold text-gray-800">{row.nonbrand}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <TrendIndicator value={row.delta} />
                      <span
                        className={clsx(
                          'text-xs font-medium',
                          row.delta > 0 && 'text-emerald-600',
                          row.delta < 0 && 'text-red-600',
                          row.delta === 0 && 'text-gray-400'
                        )}
                      >
                        {row.delta > 0 ? '+' : ''}{row.delta.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-500">{row.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Search Term Classification + Trend Analysis */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Classification Coverage */}
        <div className="card card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Search Term Classification</h3>
          <div className="flex items-center gap-6">
            <div className="flex-shrink-0">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={coveragePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {coveragePieData.map((_e, i) => (
                      <Cell key={i} fill={PIE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Coverage</span>
                <span className="text-sm font-bold text-gray-900">{formatPercent(coverage.coverage_pct, 0)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-brand-500"
                  style={{ width: `${coverage.coverage_pct}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-500">Total Terms</p>
                  <p className="font-semibold text-gray-900">{formatNumber(coverage.total_terms)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Unclassified</p>
                  <p className="font-semibold text-red-600">{formatNumber(coverage.unclassified_terms)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Brand Terms</p>
                  <p className="font-semibold text-blue-600">{formatNumber(coverage.brand_terms)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Non-brand Terms</p>
                  <p className="font-semibold text-emerald-600">{formatNumber(coverage.nonbrand_terms)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Uncertain terms */}
          {coverage.uncertain_terms.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Terms Needing Review
              </p>
              <div className="space-y-1">
                {coverage.uncertain_terms.slice(0, 5).map((t) => (
                  <div
                    key={t.term}
                    className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <span className="text-xs text-gray-700 font-medium">{t.term}</span>
                    <div className="flex items-center gap-2">
                      <span className="badge bg-gray-200 text-gray-600">{t.suggested}</span>
                      <span className="text-xs text-gray-500">{formatPercent(t.confidence * 100, 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trend Analysis */}
        <div className="card card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Trend Analysis</h3>

          <div className="space-y-4">
            {/* WoW Changes */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Week-over-Week Changes
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Brand Spend', value: wowChanges.brandSpend },
                  { label: 'Non-brand Spend', value: wowChanges.nbSpend },
                  { label: 'Brand Revenue', value: wowChanges.brandRev },
                  { label: 'Non-brand Revenue', value: wowChanges.nbRev },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <div className="flex items-center gap-1">
                      <TrendIndicator value={item.value} />
                      <span
                        className={clsx(
                          'text-sm font-bold',
                          item.value > 0 && 'text-emerald-600',
                          item.value < 0 && 'text-red-600',
                          item.value === 0 && 'text-gray-400'
                        )}
                      >
                        {item.value > 0 ? '+' : ''}{item.value.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Observations */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Key Observations
              </p>
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-2 flex-shrink-0" />
                  Brand ROAS ({formatRoas(brandData.brand_roas)}) is {((brandData.brand_roas / brandData.nonbrand_roas - 1) * 100).toFixed(0)}% higher than non-brand, but marginal ROAS tells a different story.
                </div>
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-400 mt-2 flex-shrink-0" />
                  Non-brand drives {formatPercent(brandData.nonbrand_new_customer_pct, 0)} new customers vs {formatPercent(brandData.brand_new_customer_pct, 0)} for brand.
                </div>
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-400 mt-2 flex-shrink-0" />
                  Brand marginal ROAS ({formatRoas(brandData.brand_marginal_roas)}) is significantly below non-brand ({formatRoas(brandData.nonbrand_marginal_roas)}), suggesting diminishing returns.
                </div>
              </div>
            </div>

            {/* Admin link */}
            <div className="pt-2 border-t border-gray-100">
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                <Link2 className="w-4 h-4" />
                Manage classification rules in Admin
              </a>
            </div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
