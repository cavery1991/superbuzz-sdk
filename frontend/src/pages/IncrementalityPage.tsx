import { useState, useEffect } from 'react';
import clsx from 'clsx';
import {
  Layers,
  Eye,
  FlaskConical,
  AlertTriangle,
  TrendingDown,
  Plus,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import MetricCard from '@/components/ui/MetricCard';
import LoadingState from '@/components/ui/LoadingState';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import ExperimentCard from '@/components/cards/ExperimentCard';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';
import ResponseCurveChart from '@/components/charts/ResponseCurveChart';
import {
  fetchIncrementalityObservational,
  fetchIncrementalityProxy,
  fetchExperiments,
} from '@/services/api';
import {
  formatCurrency,
  formatPercent,
  formatRoas,
  formatCompactNumber,
} from '@/utils/format';
import type {
  IncrementalityObservational,
  IncrementalityProxy,
  Experiment,
  DailyMetric,
} from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_OBS: IncrementalityObservational = {
  brand_spend: 16940,
  nonbrand_spend: 25410,
  brand_revenue: 93210,
  nonbrand_revenue: 93210,
  brand_cpa: 18.2,
  nonbrand_cpa: 38.8,
  brand_mer: 5.5,
  nonbrand_mer: 3.67,
  brand_contribution_pct: 40,
  nonbrand_contribution_pct: 60,
  brand_new_customer_pct: 12,
  nonbrand_new_customer_pct: 56,
  brand_dependence_score: 0.72,
  trend: Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const bSpend = 450 + Math.random() * 200;
    const nbSpend = 700 + Math.random() * 300;
    return {
      date: d.toISOString().split('T')[0],
      revenue: Math.round((bSpend + nbSpend) * (3.5 + Math.random())),
      spend: Math.round(bSpend + nbSpend),
      roas: +(3.5 + Math.random()).toFixed(2),
      brand_spend: Math.round(bSpend),
      nonbrand_spend: Math.round(nbSpend),
      brand_revenue: Math.round(bSpend * (4.5 + Math.random() * 2)),
      nonbrand_revenue: Math.round(nbSpend * (3 + Math.random())),
      new_customers: Math.round(8 + Math.random() * 18),
      cpa: +(25 + Math.random() * 15).toFixed(2),
      organic_traffic: Math.round(800 + Math.random() * 400),
      paid_brand_traffic: Math.round(300 + Math.random() * 200),
    } as DailyMetric;
  }),
};

const DEMO_PROXY: IncrementalityProxy = {
  cannibalization_estimate: 65,
  paid_vs_organic_correlation: -0.68,
  brand_marginal_roas: 1.2,
  nonbrand_marginal_roas: 3.9,
  spend_response_curve: Array.from({ length: 20 }, (_, i) => {
    const spend = (i + 1) * 500;
    return {
      spend,
      revenue: spend * (5 - (i * 0.15)) * (0.9 + Math.random() * 0.2),
    };
  }),
  diminishing_returns_threshold: 6000,
  organic_overlap_pct: 65,
  paid_brand_vs_organic: Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const paid = 300 + Math.random() * 200;
    return {
      date: d.toISOString().split('T')[0],
      paid_brand: Math.round(paid),
      organic_brand: Math.round(900 - paid * 0.6 + Math.random() * 100),
    };
  }),
};

const DEMO_EXPERIMENTS: Experiment[] = [
  {
    id: '1',
    name: 'Brand Holdout Test - West Coast',
    type: 'geo_holdout',
    status: 'completed',
    treatment_description: 'Paused all brand search ads in CA, OR, WA',
    control_description: 'Brand ads running normally in all other states',
    start_date: '2026-03-01',
    end_date: '2026-03-21',
    configuration: {},
    results: {
      lift_pct: 8.2,
      confidence_interval: [3.1, 13.3],
      p_value: 0.003,
      is_significant: true,
      treatment_metric: 42500,
      control_metric: 46000,
      treatment_data: Array.from({ length: 21 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        value: 1800 + Math.random() * 600,
      })),
      control_data: Array.from({ length: 21 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        value: 2000 + Math.random() * 600,
      })),
    },
    created_at: '2026-02-25',
  },
  {
    id: '2',
    name: 'Non-brand Budget Increase Test',
    type: 'budget_shift',
    status: 'running',
    treatment_description: 'Increased non-brand budget by 25%',
    control_description: 'Baseline non-brand budget',
    start_date: '2026-04-01',
    end_date: '2026-04-21',
    configuration: {},
    created_at: '2026-03-28',
  },
  {
    id: '3',
    name: 'Weekend Brand Pause',
    type: 'time_holdout',
    status: 'draft',
    treatment_description: 'Pause brand ads on weekends only',
    control_description: 'Normal brand spend on weekdays as control',
    start_date: '2026-04-15',
    end_date: '2026-05-13',
    configuration: {},
    created_at: '2026-04-05',
  },
];

type TabId = 'observational' | 'proxy' | 'experiments';

// ──────────────────────────────── Component ────────────────────────────────

export default function IncrementalityPage() {
  const [activeTab, setActiveTab] = useState<TabId>('observational');
  const [obs, setObs] = useState<IncrementalityObservational>(DEMO_OBS);
  const [proxy, setProxy] = useState<IncrementalityProxy>(DEMO_PROXY);
  const [experiments, setExperiments] = useState<Experiment[]>(DEMO_EXPERIMENTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      fetchIncrementalityObservational(),
      fetchIncrementalityProxy(),
      fetchExperiments(),
    ]).then((results) => {
      if (cancelled) return;
      const [obsR, proxyR, expR] = results;
      if (obsR.status === 'fulfilled') setObs(obsR.value);
      if (proxyR.status === 'fulfilled') setProxy(proxyR.value);
      if (expR.status === 'fulfilled' && expR.value.length > 0) setExperiments(expR.value);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const tabs: { id: TabId; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'observational', label: 'Level 1: Observational', icon: <Eye className="w-4 h-4" />, description: 'Compare brand vs non-brand at face value' },
    { id: 'proxy', label: 'Level 2: Proxy Incrementality', icon: <Layers className="w-4 h-4" />, description: 'Estimate true incremental value' },
    { id: 'experiments', label: 'Level 3: Experiments', icon: <FlaskConical className="w-4 h-4" />, description: 'Measure causality through controlled tests' },
  ];

  if (loading) {
    return (
      <PageLayout title="Incrementality Analysis" subtitle="3-level framework to understand true value of ad spend">
        <LoadingState />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Incrementality Analysis"
      subtitle="3-level framework to understand true value of ad spend"
    >
      {/* Tab Navigation */}
      <div className="flex flex-col sm:flex-row gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all flex-1',
              activeTab === tab.id
                ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            )}
          >
            {tab.icon}
            <div>
              <p className={clsx(activeTab === tab.id ? 'text-white' : 'text-gray-900', 'font-semibold text-sm')}>
                {tab.label}
              </p>
              <p className={clsx(activeTab === tab.id ? 'text-brand-100' : 'text-gray-500', 'text-xs')}>
                {tab.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'observational' && <ObservationalTab data={obs} />}
      {activeTab === 'proxy' && <ProxyTab data={proxy} />}
      {activeTab === 'experiments' && <ExperimentsTab experiments={experiments} />}
    </PageLayout>
  );
}

// ──────────────────────────────── Level 1 ────────────────────────────────

function ObservationalTab({ data }: { data: IncrementalityObservational }) {
  const trendData = data.trend.map((d) => ({
    date: d.date.slice(5),
    'Brand Spend': d.brand_spend,
    'Non-brand Spend': d.nonbrand_spend,
    'Brand Revenue': d.brand_revenue,
    'Non-brand Revenue': d.nonbrand_revenue,
  }));

  return (
    <div className="space-y-6">
      {/* Comparison Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="card card-body">
          <p className="text-xs text-gray-500 mb-1">Brand Spend</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(data.brand_spend)}</p>
          <p className="text-xs text-gray-400 mt-1">{formatPercent(data.brand_contribution_pct, 0)} of total</p>
        </div>
        <div className="card card-body">
          <p className="text-xs text-gray-500 mb-1">Non-brand Spend</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(data.nonbrand_spend)}</p>
          <p className="text-xs text-gray-400 mt-1">{formatPercent(data.nonbrand_contribution_pct, 0)} of total</p>
        </div>
        <div className="card card-body">
          <p className="text-xs text-gray-500 mb-1">Brand Dependence Score</p>
          <p className={clsx(
            'text-xl font-bold',
            data.brand_dependence_score > 0.7 ? 'text-red-600' : data.brand_dependence_score > 0.4 ? 'text-amber-600' : 'text-emerald-600'
          )}>
            {data.brand_dependence_score.toFixed(2)}
          </p>
          <div className="h-1.5 rounded-full bg-gray-200 mt-2">
            <div
              className={clsx(
                'h-1.5 rounded-full',
                data.brand_dependence_score > 0.7 ? 'bg-red-500' : data.brand_dependence_score > 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
              )}
              style={{ width: `${data.brand_dependence_score * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Metric comparison */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Brand CPA" value={formatCurrency(data.brand_cpa)} />
        <MetricCard label="Non-brand CPA" value={formatCurrency(data.nonbrand_cpa)} />
        <MetricCard label="Brand MER" value={formatRoas(data.brand_mer)} />
        <MetricCard label="Non-brand MER" value={formatRoas(data.nonbrand_mer)} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Brand New Customer %" value={formatPercent(data.brand_new_customer_pct)} />
        <MetricCard label="Non-brand New Customer %" value={formatPercent(data.nonbrand_new_customer_pct)} />
        <MetricCard label="Brand Revenue" value={formatCompactNumber(data.brand_revenue)} prefix="$" />
        <MetricCard label="Non-brand Revenue" value={formatCompactNumber(data.nonbrand_revenue)} prefix="$" />
      </div>

      {/* Trend */}
      <div className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Trend Over Time</h3>
        <TimeSeriesChart
          data={trendData}
          xKey="date"
          lines={[
            { dataKey: 'Brand Spend', name: 'Brand Spend', color: '#3399FF' },
            { dataKey: 'Non-brand Spend', name: 'Non-brand Spend', color: '#10B981' },
            { dataKey: 'Brand Revenue', name: 'Brand Revenue', color: '#85C2FF', strokeDasharray: '5 5' },
            { dataKey: 'Non-brand Revenue', name: 'Non-brand Revenue', color: '#6EE7B7', strokeDasharray: '5 5' },
          ]}
          height={300}
        />
      </div>

      {/* Warning */}
      {data.brand_dependence_score > 0.5 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Observational Limitation</p>
            <p className="text-sm text-amber-700 mt-1">
              Brand metrics look strong at face value, but a high brand dependence score ({data.brand_dependence_score.toFixed(2)}) suggests these numbers
              may be inflated by organic conversions captured by paid brand. See Level 2 for proxy incrementality estimates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────── Level 2 ────────────────────────────────

function ProxyTab({ data }: { data: IncrementalityProxy }) {
  const paidOrgData = data.paid_brand_vs_organic.map((d) => ({
    date: d.date.slice(5),
    'Paid Brand': d.paid_brand,
    'Organic Brand': d.organic_brand,
  }));

  const curveData = data.spend_response_curve.map((d) => ({
    spend: formatCompactNumber(d.spend),
    revenue: Math.round(d.revenue),
    rawSpend: d.spend,
  }));

  return (
    <div className="space-y-6">
      {/* Key Finding */}
      <div className="card card-body border-l-4 border-l-brand-500">
        <div className="flex items-start gap-3">
          <TrendingDown className="w-6 h-6 text-brand-600 mt-0.5" />
          <div>
            <p className="text-base font-bold text-gray-900">
              Estimated {data.cannibalization_estimate}% of paid brand traffic would have come through organic
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Based on correlation analysis between paid brand and organic brand traffic, and spend-response curve modeling.
            </p>
          </div>
        </div>
      </div>

      {/* Cannibalization Gauge */}
      <div className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Cannibalization Estimate</h3>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">0% (fully incremental)</span>
              <span className="text-sm text-gray-500">100% (fully cannibalized)</span>
            </div>
            <div className="relative h-6 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-200">
              <div
                className="absolute top-0 h-6 w-1.5 bg-gray-900 rounded-full shadow-lg"
                style={{ left: `calc(${data.cannibalization_estimate}% - 3px)` }}
              />
            </div>
            <div className="text-center mt-3">
              <span className={clsx(
                'text-3xl font-bold',
                data.cannibalization_estimate > 60 ? 'text-red-600' : data.cannibalization_estimate > 30 ? 'text-amber-600' : 'text-emerald-600'
              )}>
                {data.cannibalization_estimate}%
              </span>
              <p className="text-sm text-gray-500 mt-1">estimated cannibalization rate</p>
            </div>
          </div>
          <div className="w-px h-24 bg-gray-200" />
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-500">Paid vs Organic Correlation</p>
              <p className="font-bold text-gray-900">{data.paid_vs_organic_correlation.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Organic Overlap</p>
              <p className="font-bold text-gray-900">{formatPercent(data.organic_overlap_pct, 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Paid Brand vs Organic Chart */}
      <div className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Paid Brand vs Organic Brand Traffic</h3>
        <p className="text-xs text-gray-500 mb-4">
          Inverse correlation suggests paid brand captures traffic that would have come organically
        </p>
        <TimeSeriesChart
          data={paidOrgData}
          xKey="date"
          lines={[
            { dataKey: 'Paid Brand', name: 'Paid Brand Traffic', color: '#3399FF' },
            { dataKey: 'Organic Brand', name: 'Organic Brand Traffic', color: '#10B981' },
          ]}
          height={280}
        />
      </div>

      {/* Spend Response Curve */}
      <div className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Spend-Response Curve</h3>
        <p className="text-xs text-gray-500 mb-4">
          Red line marks the diminishing returns threshold at {formatCurrency(data.diminishing_returns_threshold)}
        </p>
        <ResponseCurveChart
          data={curveData}
          xKey="spend"
          yKey="revenue"
          threshold={data.diminishing_returns_threshold}
          height={300}
        />
      </div>

      {/* Marginal ROAS Comparison */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card card-body border-l-4 border-l-blue-400">
          <p className="text-xs text-gray-500 mb-1">Brand Marginal ROAS</p>
          <p className="text-3xl font-bold text-gray-900">{formatRoas(data.brand_marginal_roas)}</p>
          <p className="text-xs text-gray-500 mt-2">
            {data.brand_marginal_roas < 1
              ? 'Below breakeven - each additional dollar loses money'
              : data.brand_marginal_roas < 2
                ? 'Barely above breakeven - limited incremental value'
                : 'Healthy marginal return on brand spend'}
          </p>
        </div>
        <div className="card card-body border-l-4 border-l-emerald-400">
          <p className="text-xs text-gray-500 mb-1">Non-brand Marginal ROAS</p>
          <p className="text-3xl font-bold text-gray-900">{formatRoas(data.nonbrand_marginal_roas)}</p>
          <p className="text-xs text-gray-500 mt-2">
            {data.nonbrand_marginal_roas > 3
              ? 'Strong incremental returns - room to scale'
              : data.nonbrand_marginal_roas > 1.5
                ? 'Moderate returns - near optimal spend level'
                : 'Approaching diminishing returns'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────── Level 3 ────────────────────────────────

function ExperimentsTab({ experiments }: { experiments: Experiment[] }) {
  const running = experiments.filter((e) => e.status === 'running');
  const completed = experiments.filter((e) => e.status === 'completed');
  const drafts = experiments.filter((e) => e.status === 'draft');

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Active Experiments" value={running.length} />
        <MetricCard label="Completed" value={completed.length} />
        <MetricCard label="Drafts" value={drafts.length} />
        <MetricCard label="Total" value={experiments.length} />
      </div>

      {/* Running Experiments */}
      {running.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-900 mb-3">Running Experiments</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {running.map((exp) => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))}
          </div>
        </div>
      )}

      {/* Completed Results */}
      {completed.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-900 mb-3">Completed Experiments</h3>
          <div className="space-y-4">
            {completed.map((exp) => (
              <div key={exp.id} className="space-y-3">
                <ExperimentCard experiment={exp} />
                {exp.results && (
                  <div className="card card-body ml-4 border-l-4 border-l-brand-400">
                    <div className="flex items-center gap-4 mb-3">
                      <div>
                        <p className="text-xs text-gray-500">Measured Lift</p>
                        <p className={clsx(
                          'text-2xl font-bold',
                          exp.results.lift_pct > 0 ? 'text-emerald-600' : 'text-red-600'
                        )}>
                          {exp.results.lift_pct > 0 ? '+' : ''}{formatPercent(exp.results.lift_pct)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Confidence Interval</p>
                        <p className="text-sm font-semibold text-gray-700">
                          [{formatPercent(exp.results.confidence_interval[0])} to {formatPercent(exp.results.confidence_interval[1])}]
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">p-value</p>
                        <p className="text-sm font-semibold text-gray-700">{exp.results.p_value.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Significant?</p>
                        <ConfidenceBadge level={exp.results.is_significant ? 'high' : 'low'} />
                      </div>
                    </div>
                    {/* Treatment vs Control chart */}
                    <TimeSeriesChart
                      data={exp.results.treatment_data.map((td, i) => ({
                        date: td.date.slice(5),
                        Treatment: Math.round(td.value),
                        Control: Math.round(exp.results!.control_data[i]?.value || 0),
                      }))}
                      xKey="date"
                      lines={[
                        { dataKey: 'Treatment', name: 'Treatment', color: '#3399FF' },
                        { dataKey: 'Control', name: 'Control', color: '#9CA3AF' },
                      ]}
                      height={200}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drafts */}
      {drafts.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-900 mb-3">Draft Experiments</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {drafts.map((exp) => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))}
          </div>
        </div>
      )}

      {/* Design New Experiment CTA */}
      <div className="card card-body text-center py-8">
        <FlaskConical className="w-10 h-10 text-brand-400 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-gray-900 mb-1">Design a New Experiment</h3>
        <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
          Run controlled experiments to measure the true incremental value of your ad spend with statistical confidence.
        </p>
        <a
          href="/experiments"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Experiment
        </a>
      </div>
    </div>
  );
}
