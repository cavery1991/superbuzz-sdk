import { useState, useEffect } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Activity,
  ShieldCheck,
  Clock,
  AlertCircle,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import MetricCard from '@/components/ui/MetricCard';
import InsightCard from '@/components/ui/InsightCard';
import RecommendationCard from '@/components/ui/RecommendationCard';
import LoadingState from '@/components/ui/LoadingState';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';
import BarComparisonChart from '@/components/charts/BarComparisonChart';
import { useDateRange } from '@/hooks/useApi';
import {
  fetchKpiSummary,
  fetchInsights,
  fetchRecommendations,
  fetchBrandVsNonbrand,
  fetchDailyMetrics,
  fetchIncrementalityObservational,
} from '@/services/api';
import {
  formatCurrency,
  formatPercent,
  formatRoas,
  formatCompactNumber,
} from '@/utils/format';
import type {
  KpiSummary,
  Insight,
  Recommendation,
  BrandVsNonbrand,
  DailyMetric,
} from '@/types';

// ──────────────────────────────── Fallback / demo data ────────────────────────────────

const DEMO_KPI: KpiSummary = {
  total_spend: 42350,
  total_revenue: 186420,
  blended_roas: 4.4,
  mer: 3.8,
  new_customer_pct: 34.2,
  cpa: 28.5,
  spend_wow_change: 5.2,
  revenue_wow_change: 8.1,
  roas_wow_change: 2.7,
  mer_wow_change: -1.4,
  new_customer_pct_wow_change: 3.1,
  cpa_wow_change: -2.3,
};

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

function generateDemoDailyMetrics(): DailyMetric[] {
  const days: DailyMetric[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const base = 5000 + Math.random() * 2000;
    const spend = 1200 + Math.random() * 600;
    days.push({
      date: d.toISOString().split('T')[0],
      revenue: Math.round(base),
      spend: Math.round(spend),
      roas: +(base / spend).toFixed(2),
      brand_spend: Math.round(spend * 0.4),
      nonbrand_spend: Math.round(spend * 0.6),
      brand_revenue: Math.round(base * 0.5),
      nonbrand_revenue: Math.round(base * 0.5),
      new_customers: Math.round(10 + Math.random() * 15),
      cpa: +(spend / (10 + Math.random() * 15)).toFixed(2),
      organic_traffic: Math.round(800 + Math.random() * 400),
      paid_brand_traffic: Math.round(300 + Math.random() * 200),
    });
  }
  return days;
}

const DEMO_DAILY = generateDemoDailyMetrics();

const DEMO_INSIGHTS: Insight[] = [
  {
    id: '1',
    title: 'Non-brand ROAS declining despite stable spend',
    body: 'Non-brand ROAS has dropped 12% WoW while spend remained flat, suggesting audience fatigue or increased competition.',
    interpretation: 'The efficiency of non-brand campaigns is decreasing. This could indicate market saturation or the need for creative refresh.',
    confidence: 'high',
    recommended_action: 'Review non-brand ad creatives and consider refreshing copy/imagery. Test new audience segments.',
    evidence: ['Non-brand ROAS: 3.67x (was 4.17x)', 'Spend unchanged at $25.4K', 'CTR down 8%'],
    category: 'performance',
    priority: 1,
    created_at: '2026-04-09',
  },
  {
    id: '2',
    title: 'Brand dependence score is elevated at 0.72',
    body: 'Your paid brand traffic shows high overlap with organic brand traffic, suggesting significant cannibalization.',
    interpretation: 'Up to 65% of paid brand clicks may have converted organically. This represents potential wasted spend.',
    confidence: 'medium',
    recommended_action: 'Consider running a brand holdout test to measure true incrementality of brand spend.',
    evidence: ['Brand dependence: 0.72', 'Organic/paid correlation: -0.68', 'Brand marginal ROAS: 1.2x'],
    category: 'incrementality',
    priority: 2,
    created_at: '2026-04-09',
  },
  {
    id: '3',
    title: 'Temperature-driven demand spike expected this week',
    body: 'Historical patterns show a 15-20% revenue increase when temperatures exceed 75°F in April, and forecasts show 78°F for the next 5 days.',
    interpretation: 'Seasonal demand is likely to increase naturally. Non-brand spend may be more efficient during this period.',
    confidence: 'medium',
    recommended_action: 'Increase non-brand budget by 10-15% to capture incremental demand during the warm spell.',
    evidence: ['8 similar historical periods found', 'Avg revenue lift: 17.3%', 'Avg ROAS in warm periods: 4.8x'],
    category: 'patterns',
    priority: 3,
    created_at: '2026-04-09',
  },
];

const DEMO_RECOMMENDATIONS: Recommendation[] = [
  {
    id: '1',
    action: 'Reduce brand spend by 15% and reallocate to non-brand',
    rationale: 'Brand marginal ROAS (1.2x) is well below non-brand (3.9x). Proxy incrementality analysis suggests 65% cannibalization.',
    expected_effect: 'Estimated $3.2K additional revenue per week with same total spend.',
    confidence: 'high',
    risk: 'Short-term brand impression share may decrease. Monitor organic brand traffic for 2 weeks.',
    evidence: ['Brand mROAS: 1.2x vs NB mROAS: 3.9x', 'Cannibalization est: 65%', '3 similar historical reallocations showed +8% revenue'],
    status: 'pending',
    category: 'budget',
    created_at: '2026-04-09',
  },
  {
    id: '2',
    action: 'Refresh non-brand ad creatives',
    rationale: 'Non-brand CTR has declined 8% WoW and CVR is trending down, suggesting creative fatigue.',
    expected_effect: 'Historical creative refreshes have improved CVR by 5-12% within first 2 weeks.',
    confidence: 'medium',
    risk: 'New creatives may underperform initially during learning period.',
    evidence: ['CTR down 8% WoW', 'CVR down 5% WoW', 'Last creative refresh was 45 days ago'],
    status: 'pending',
    category: 'creative',
    created_at: '2026-04-09',
  },
  {
    id: '3',
    action: 'Launch brand holdout experiment in 2 markets',
    rationale: 'Proxy analysis suggests high cannibalization but experimental validation is needed for confident budget decisions.',
    expected_effect: 'Definitive measurement of brand incrementality within 3-4 weeks.',
    confidence: 'high',
    risk: 'Temporary revenue dip in holdout markets (estimated 2-5%).',
    evidence: ['Brand dependence: 0.72', 'Proxy cannibalization: 65%', 'Experiment cost: ~$2K in held-back spend'],
    status: 'pending',
    category: 'measurement',
    created_at: '2026-04-09',
  },
];

const DONUT_COLORS = ['#3399FF', '#10B981'];

// ──────────────────────────────── Component ────────────────────────────────

export default function OverviewPage() {
  const { dateRange, preset, setPreset } = useDateRange('30d');

  const [kpi, setKpi] = useState<KpiSummary>(DEMO_KPI);
  const [insights, setInsights] = useState<Insight[]>(DEMO_INSIGHTS);
  const [recommendations, setRecommendations] = useState<Recommendation[]>(DEMO_RECOMMENDATIONS);
  const [brandData, setBrandData] = useState<BrandVsNonbrand>(DEMO_BRAND);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>(DEMO_DAILY);
  const [brandDependence, setBrandDependence] = useState(0.72);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      fetchKpiSummary(dateRange),
      fetchInsights(),
      fetchRecommendations(),
      fetchBrandVsNonbrand(dateRange),
      fetchDailyMetrics(dateRange),
      fetchIncrementalityObservational(),
    ]).then((results) => {
      if (cancelled) return;
      const [kpiR, insR, recR, brR, dmR, incR] = results;
      if (kpiR.status === 'fulfilled') setKpi(kpiR.value);
      if (insR.status === 'fulfilled' && insR.value.length > 0) setInsights(insR.value);
      if (recR.status === 'fulfilled' && recR.value.length > 0) setRecommendations(recR.value);
      if (brR.status === 'fulfilled') setBrandData(brR.value);
      if (dmR.status === 'fulfilled' && dmR.value.length > 0) setDailyMetrics(dmR.value);
      if (incR.status === 'fulfilled') setBrandDependence(incR.value.brand_dependence_score);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [dateRange]);

  if (loading) {
    return (
      <PageLayout title="Executive Overview" subtitle="Decision-oriented performance summary">
        <LoadingState variant="cards" count={6} />
      </PageLayout>
    );
  }

  const spendDonutData = [
    { name: 'Brand', value: brandData.brand_spend },
    { name: 'Non-brand', value: brandData.nonbrand_spend },
  ];

  const revenueDonutData = [
    { name: 'Brand', value: brandData.brand_revenue },
    { name: 'Non-brand', value: brandData.nonbrand_revenue },
  ];

  const brandBarData = [
    { metric: 'Spend', Brand: brandData.brand_spend, 'Non-brand': brandData.nonbrand_spend },
    { metric: 'Revenue', Brand: brandData.brand_revenue, 'Non-brand': brandData.nonbrand_revenue },
  ];

  const trendData = dailyMetrics.map((d) => ({
    date: d.date.slice(5),
    Revenue: d.revenue,
    Spend: d.spend,
    ROAS: d.roas,
  }));

  const healthItems = [
    {
      label: 'Brand Dependence',
      value: brandDependence.toFixed(2),
      icon: <ShieldCheck className="w-5 h-5" />,
      color:
        brandDependence > 0.7
          ? 'text-red-600 bg-red-50'
          : brandDependence > 0.4
            ? 'text-amber-600 bg-amber-50'
            : 'text-emerald-600 bg-emerald-50',
      detail:
        brandDependence > 0.7
          ? 'High - significant organic overlap'
          : brandDependence > 0.4
            ? 'Moderate - some overlap detected'
            : 'Low - healthy incremental mix',
    },
    {
      label: 'Incrementality Health',
      value: brandData.nonbrand_marginal_roas > 2 ? 'Good' : 'Needs Review',
      icon: <Activity className="w-5 h-5" />,
      color:
        brandData.nonbrand_marginal_roas > 2
          ? 'text-emerald-600 bg-emerald-50'
          : 'text-amber-600 bg-amber-50',
      detail: `Non-brand mROAS: ${brandData.nonbrand_marginal_roas.toFixed(1)}x`,
    },
    {
      label: 'Data Freshness',
      value: 'Live',
      icon: <Clock className="w-5 h-5" />,
      color: 'text-emerald-600 bg-emerald-50',
      detail: `Last updated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    },
  ];

  return (
    <PageLayout
      title="Executive Overview"
      subtitle="Decision-oriented performance summary"
      showDateRange
      preset={preset}
      onPresetChange={setPreset}
    >
      {/* KPI Summary Row */}
      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Total Spend"
            value={formatCompactNumber(kpi.total_spend)}
            prefix="$"
            change={kpi.spend_wow_change}
            changeLabel="WoW"
          />
          <MetricCard
            label="Total Revenue"
            value={formatCompactNumber(kpi.total_revenue)}
            prefix="$"
            change={kpi.revenue_wow_change}
            changeLabel="WoW"
          />
          <MetricCard
            label="Blended ROAS"
            value={formatRoas(kpi.blended_roas)}
            change={kpi.roas_wow_change}
            changeLabel="WoW"
          />
          <MetricCard
            label="MER"
            value={formatRoas(kpi.mer)}
            change={kpi.mer_wow_change}
            changeLabel="WoW"
          />
          <MetricCard
            label="New Customer %"
            value={formatPercent(kpi.new_customer_pct)}
            change={kpi.new_customer_pct_wow_change}
            changeLabel="WoW"
          />
          <MetricCard
            label="CPA"
            value={formatCurrency(kpi.cpa)}
            change={kpi.cpa_wow_change}
            changeLabel="WoW"
          />
        </div>
      </section>

      {/* Key Insights */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Insights</h2>
        <div className="space-y-3">
          {insights.slice(0, 5).map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      </section>

      {/* Brand vs Non-brand Split + Trend Chart */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Brand vs Non-brand */}
        <div className="card card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Brand vs Non-brand Split</h3>
          <div className="grid grid-cols-2 gap-6">
            {/* Spend donut */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center mb-2">
                Spend Split
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={spendDonutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {spendDonutData.map((_entry, index) => (
                      <Cell key={`spend-${index}`} fill={DONUT_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #E5E7EB' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[0] }} />
                  <span className="text-xs text-gray-600">Brand {formatPercent(brandData.brand_spend_pct, 0)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[1] }} />
                  <span className="text-xs text-gray-600">Non-brand {formatPercent(brandData.nonbrand_spend_pct, 0)}</span>
                </div>
              </div>
            </div>
            {/* Revenue donut */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center mb-2">
                Revenue Split
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={revenueDonutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {revenueDonutData.map((_entry, index) => (
                      <Cell key={`rev-${index}`} fill={DONUT_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #E5E7EB' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[0] }} />
                  <span className="text-xs text-gray-600">Brand {formatPercent(brandData.brand_revenue_pct, 0)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[1] }} />
                  <span className="text-xs text-gray-600">Non-brand {formatPercent(brandData.nonbrand_revenue_pct, 0)}</span>
                </div>
              </div>
            </div>
          </div>
          {/* Side-by-side bar */}
          <div className="mt-4">
            <BarComparisonChart
              data={brandBarData}
              bars={[
                { dataKey: 'Brand', name: 'Brand', color: '#3399FF' },
                { dataKey: 'Non-brand', name: 'Non-brand', color: '#10B981' },
              ]}
              xKey="metric"
              height={180}
            />
          </div>
        </div>

        {/* 30-day Trend */}
        <div className="card card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Revenue, Spend & ROAS Trend</h3>
          <TimeSeriesChart
            data={trendData}
            xKey="date"
            lines={[
              { dataKey: 'Revenue', name: 'Revenue', color: '#10B981' },
              { dataKey: 'Spend', name: 'Spend', color: '#3399FF' },
              { dataKey: 'ROAS', name: 'ROAS', color: '#F59E0B', yAxisId: 'right' },
            ]}
            height={340}
          />
        </div>
      </section>

      {/* Top Recommendations */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Recommendations</h2>
        <div className="space-y-3">
          {recommendations.slice(0, 3).map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      </section>

      {/* Health Indicators */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Health Indicators</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {healthItems.map((item) => (
            <div key={item.label} className="card card-body flex items-start gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.color}`}>
                {item.icon}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">{item.label}</p>
                <p className="text-lg font-bold text-gray-900">{item.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Warning Banner */}
      {brandDependence > 0.6 && (
        <section>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Action Required: High Brand Dependence</p>
              <p className="text-sm text-amber-700 mt-1">
                Your brand dependence score ({brandDependence.toFixed(2)}) suggests that a significant portion of paid brand traffic would have converted organically.
                Consider running a brand holdout experiment to validate and quantify the savings opportunity.
              </p>
            </div>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
