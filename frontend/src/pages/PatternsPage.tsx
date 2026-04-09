import { useState, useEffect } from 'react';
import {
  Brain,
  Search,
  Calendar,
  Thermometer,
  Tag,
  BarChart3,
  TrendingUp,
  Lightbulb,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import LoadingState from '@/components/ui/LoadingState';
import SimilarStateCard from '@/components/cards/SimilarStateCard';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import { fetchSimilarPatterns } from '@/services/api';
import { formatCurrency, formatPercent } from '@/utils/format';
import type { SimilarState, ContextQuery, PatternInsight } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TEMP_RANGES = ['< 40°F', '40-55°F', '55-70°F', '70-85°F', '> 85°F'];
const SPEND_LEVELS = ['low', 'medium', 'high', 'very_high'];
const BRAND_SPLITS = ['< 30%', '30-40%', '40-50%', '50-60%', '> 60%'];

const now = new Date();
const CURRENT_STATE = {
  day_of_week: DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1],
  month: MONTHS[now.getMonth()],
  temperature: '70-85°F',
  spend_level: 'medium',
  promo_status: 'inactive',
  brand_split: '40-50%',
};

function generateDemoResults(): SimilarState[] {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (7 + i * 14 + Math.floor(Math.random() * 7)));
    return {
      date: d.toISOString().split('T')[0],
      similarity_score: 0.92 - i * 0.06 + Math.random() * 0.03,
      day_of_week: DAYS_OF_WEEK[Math.floor(Math.random() * 5)],
      month: MONTHS[Math.floor(Math.random() * 3) + now.getMonth() - 1] || 'March',
      temperature: 68 + Math.floor(Math.random() * 15),
      spend_level: 'medium',
      promo_active: i < 2,
      brand_split_pct: 38 + Math.random() * 10,
      revenue: 5200 + Math.random() * 2000,
      roas: 3.8 + Math.random() * 1.5,
      cvr: 3.2 + Math.random() * 2,
      new_customers: Math.round(12 + Math.random() * 15),
      marginal_return: 2.5 + Math.random() * 2,
      cpa: 25 + Math.random() * 15,
    };
  });
}

const DEMO_INSIGHTS: PatternInsight[] = [
  {
    text: 'In similar conditions, increasing spend beyond $1,800/day showed diminishing marginal returns (mROAS dropped below 2x).',
    confidence: 'high',
  },
  {
    text: 'Revenue averaged $6,200 on comparable days, with a standard deviation of $850, suggesting moderate predictability.',
    confidence: 'high',
  },
  {
    text: 'Non-brand CVR was 18% higher on similar warm-weather weekdays compared to cold-weather equivalents.',
    confidence: 'medium',
  },
  {
    text: 'Brand spend above 45% of total budget in these conditions consistently yielded lower marginal returns.',
    confidence: 'medium',
  },
  {
    text: 'Promo days in similar conditions showed 22% higher revenue but only 8% higher new customer acquisition.',
    confidence: 'low',
  },
];

// ──────────────────────────────── Component ────────────────────────────────

export default function PatternsPage() {
  const [query, setQuery] = useState<ContextQuery>({
    day_of_week: CURRENT_STATE.day_of_week,
    month: CURRENT_STATE.month,
    temperature_range: CURRENT_STATE.temperature,
    spend_level: CURRENT_STATE.spend_level,
    promo_status: CURRENT_STATE.promo_status,
    brand_split: CURRENT_STATE.brand_split,
  });
  const [results, setResults] = useState<SimilarState[]>(generateDemoResults());
  const [insights] = useState<PatternInsight[]>(DEMO_INSIGHTS);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(true);

  const handleSearch = () => {
    setLoading(true);
    setHasSearched(true);

    fetchSimilarPatterns(query)
      .then((data) => {
        if (data.length > 0) setResults(data);
        else setResults(generateDemoResults());
      })
      .catch(() => {
        setResults(generateDemoResults());
      })
      .finally(() => setLoading(false));
  };

  // Auto-search on mount
  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggregated outcomes
  const avgRevenue = results.length > 0 ? results.reduce((s, r) => s + r.revenue, 0) / results.length : 0;
  const avgCvr = results.length > 0 ? results.reduce((s, r) => s + r.cvr, 0) / results.length : 0;
  const avgNewCust = results.length > 0 ? results.reduce((s, r) => s + r.new_customers, 0) / results.length : 0;
  const avgMarginal = results.length > 0 ? results.reduce((s, r) => s + r.marginal_return, 0) / results.length : 0;
  const avgRoas = results.length > 0 ? results.reduce((s, r) => s + r.roas, 0) / results.length : 0;
  const revenueStd = results.length > 1
    ? Math.sqrt(results.reduce((s, r) => s + Math.pow(r.revenue - avgRevenue, 2), 0) / (results.length - 1))
    : 0;

  return (
    <PageLayout
      title="Pattern Memory"
      subtitle="Find what happened in similar historical conditions"
    >
      {/* Current State Panel */}
      <section className="card card-body">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-brand-600" />
          <h3 className="text-base font-semibold text-gray-900">Current Context</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-brand-100 text-brand-700 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {CURRENT_STATE.day_of_week}
          </span>
          <span className="badge bg-brand-100 text-brand-700">
            {CURRENT_STATE.month}
          </span>
          <span className="badge bg-brand-100 text-brand-700 flex items-center gap-1">
            <Thermometer className="w-3 h-3" />
            {CURRENT_STATE.temperature}
          </span>
          <span className="badge bg-brand-100 text-brand-700 flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            Spend: {CURRENT_STATE.spend_level}
          </span>
          <span className="badge bg-gray-100 text-gray-600 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            Promo: {CURRENT_STATE.promo_status}
          </span>
          <span className="badge bg-gray-100 text-gray-600">
            Brand: {CURRENT_STATE.brand_split}
          </span>
        </div>
      </section>

      {/* Query Builder */}
      <section className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Query Builder</h3>
        <p className="text-sm text-gray-500 mb-4">
          Adjust parameters to find historical days with similar conditions. The system uses weighted similarity matching.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Day of Week</label>
            <select
              value={query.day_of_week || ''}
              onChange={(e) => setQuery({ ...query, day_of_week: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              {DAYS_OF_WEEK.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
            <select
              value={query.month || ''}
              onChange={(e) => setQuery({ ...query, month: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Temperature</label>
            <select
              value={query.temperature_range || ''}
              onChange={(e) => setQuery({ ...query, temperature_range: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              {TEMP_RANGES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Spend Level</label>
            <select
              value={query.spend_level || ''}
              onChange={(e) => setQuery({ ...query, spend_level: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              {SPEND_LEVELS.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Promo Status</label>
            <select
              value={query.promo_status || ''}
              onChange={(e) => setQuery({ ...query, promo_status: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Brand Split</label>
            <select
              value={query.brand_split || ''}
              onChange={(e) => setQuery({ ...query, brand_split: e.target.value || undefined })}
              className="input"
            >
              <option value="">Any</option>
              {BRAND_SPLITS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Find Similar Days
          </button>
        </div>
      </section>

      {loading && <LoadingState />}

      {hasSearched && !loading && (
        <>
          {/* Outcome Summary */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Avg Revenue</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(avgRevenue)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Avg ROAS</p>
              <p className="text-lg font-bold text-gray-900">{avgRoas.toFixed(2)}x</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Avg CVR</p>
              <p className="text-lg font-bold text-gray-900">{formatPercent(avgCvr)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Avg New Customers</p>
              <p className="text-lg font-bold text-gray-900">{avgNewCust.toFixed(1)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Avg Marginal Return</p>
              <p className="text-lg font-bold text-gray-900">{avgMarginal.toFixed(2)}x</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Revenue Consistency</p>
              <p className={clsx(
                'text-lg font-bold',
                revenueStd / avgRevenue < 0.15 ? 'text-emerald-600' : revenueStd / avgRevenue < 0.25 ? 'text-amber-600' : 'text-red-600'
              )}>
                {revenueStd / avgRevenue < 0.15 ? 'High' : revenueStd / avgRevenue < 0.25 ? 'Moderate' : 'Low'}
              </p>
              <p className="text-xs text-gray-400">SD: {formatCurrency(revenueStd, 0)}</p>
            </div>
          </section>

          {/* Decision Context */}
          <section className="card card-body border-l-4 border-l-brand-500">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-6 h-6 text-brand-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">What Usually Happens</h3>
                <p className="text-sm text-gray-700">
                  Based on <strong>{results.length} similar historical days</strong>, revenue typically ranges from{' '}
                  <strong>{formatCurrency(avgRevenue - revenueStd)}</strong> to{' '}
                  <strong>{formatCurrency(avgRevenue + revenueStd)}</strong>.{' '}
                  Average ROAS is <strong>{avgRoas.toFixed(2)}x</strong> and marginal returns average{' '}
                  <strong>{avgMarginal.toFixed(2)}x</strong>.{' '}
                  {avgMarginal > 3
                    ? 'There appears to be room to increase spend profitably in these conditions.'
                    : avgMarginal > 2
                      ? 'Current spend levels appear near-optimal for these conditions.'
                      : 'Marginal returns are modest - be cautious with additional spend.'}
                </p>
              </div>
            </div>
          </section>

          {/* Pattern Insights */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-5 h-5 text-brand-600" />
              <h3 className="text-base font-semibold text-gray-900">Pattern Insights</h3>
            </div>
            <div className="space-y-3">
              {insights.map((insight, i) => (
                <div key={i} className="card card-body flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-gray-700">{insight.text}</p>
                  </div>
                  <ConfidenceBadge level={insight.confidence} />
                </div>
              ))}
            </div>
          </section>

          {/* Similar State Results */}
          <section>
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Similar Historical Days ({results.length} matches)
            </h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {results.map((state) => (
                <SimilarStateCard key={state.date} state={state} />
              ))}
            </div>
          </section>
        </>
      )}
    </PageLayout>
  );
}
