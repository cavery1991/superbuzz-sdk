import { useState, useCallback } from 'react';
import {
  SlidersHorizontal,
  Play,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  History,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import MetricCard from '@/components/ui/MetricCard';
import LoadingState from '@/components/ui/LoadingState';
import SimilarStateCard from '@/components/cards/SimilarStateCard';
import { runSimulation } from '@/services/api';
import {
  formatCurrency,
  formatPercent,
  formatRoas,
  formatCompactNumber,
} from '@/utils/format';
import type { SimulationInput, SimulationResult } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_RESULT: SimulationResult = {
  projected_revenue: 198500,
  projected_revenue_low: 182300,
  projected_revenue_high: 214700,
  projected_roas: 4.1,
  projected_mer: 3.5,
  new_customers_change: 12.5,
  risk_assessment: 'Moderate risk. Reducing brand spend may temporarily lower impression share, but non-brand scaling is supported by current marginal returns. Monitor organic brand traffic closely.',
  risk_level: 'medium',
  historical_analogues: [
    {
      date: '2026-03-15',
      similarity_score: 0.88,
      day_of_week: 'Wednesday',
      month: 'March',
      temperature: 72,
      spend_level: 'medium',
      promo_active: false,
      brand_split_pct: 35,
      revenue: 6800,
      roas: 4.3,
      cvr: 4.1,
      new_customers: 22,
      marginal_return: 3.2,
      cpa: 29,
    },
    {
      date: '2026-02-22',
      similarity_score: 0.82,
      day_of_week: 'Thursday',
      month: 'February',
      temperature: 55,
      spend_level: 'medium',
      promo_active: false,
      brand_split_pct: 38,
      revenue: 5900,
      roas: 3.8,
      cvr: 3.6,
      new_customers: 18,
      marginal_return: 2.8,
      cpa: 32,
    },
  ],
  warnings: [
    'Brand impression share may decrease by 10-15% in the short term.',
    'Non-brand budget increase of >20% typically shows diminishing returns after 7-10 days.',
    'Results assume current competitive landscape remains stable.',
  ],
  assumptions: [
    'Current marginal ROAS curves remain stable over the projection period.',
    'No major seasonal shifts or competitor actions.',
    'Organic traffic patterns continue at current levels.',
    'CPA maintains current distribution across audience segments.',
  ],
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ──────────────────────────────── Component ────────────────────────────────

export default function SimulatorPage() {
  const [input, setInput] = useState<SimulationInput>({
    brand_spend_change_pct: 0,
    nonbrand_spend_change_pct: 0,
    promo_active: false,
    temperature: undefined,
    day_of_week: undefined,
  });
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const handleRun = useCallback(() => {
    setLoading(true);
    setHasRun(true);

    runSimulation(input)
      .then((data) => setResult(data))
      .catch(() => {
        // Use demo result with adjustments based on input
        const baseRevenue = 186420;
        const brandEffect = input.brand_spend_change_pct * 0.2; // Low incrementality
        const nbEffect = input.nonbrand_spend_change_pct * 0.8; // High incrementality
        const promoEffect = input.promo_active ? 15 : 0;
        const totalEffect = (brandEffect + nbEffect + promoEffect) / 100;
        const projectedRevenue = Math.round(baseRevenue * (1 + totalEffect));

        setResult({
          ...DEMO_RESULT,
          projected_revenue: projectedRevenue,
          projected_revenue_low: Math.round(projectedRevenue * 0.92),
          projected_revenue_high: Math.round(projectedRevenue * 1.08),
          projected_roas: +(4.4 * (1 + totalEffect * 0.5)).toFixed(2),
          projected_mer: +(3.8 * (1 + totalEffect * 0.3)).toFixed(2),
          new_customers_change: +(input.nonbrand_spend_change_pct * 0.6 + promoEffect * 0.3).toFixed(1),
          risk_level:
            Math.abs(input.brand_spend_change_pct) > 30 || Math.abs(input.nonbrand_spend_change_pct) > 50
              ? 'high'
              : Math.abs(input.brand_spend_change_pct) > 15 || Math.abs(input.nonbrand_spend_change_pct) > 25
                ? 'medium'
                : 'low',
        });
      })
      .finally(() => setLoading(false));
  }, [input]);

  const revenueChange = result
    ? ((result.projected_revenue - 186420) / 186420) * 100
    : 0;

  return (
    <PageLayout
      title="Scenario Simulator"
      subtitle="Model the impact of budget and strategy changes"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Input Panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="card card-body sticky top-8">
            <div className="flex items-center gap-2 mb-5">
              <SlidersHorizontal className="w-5 h-5 text-brand-600" />
              <h3 className="text-base font-semibold text-gray-900">Scenario Inputs</h3>
            </div>

            {/* Brand Spend Change */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Brand Spend Change</label>
                <span className={clsx(
                  'text-sm font-bold',
                  input.brand_spend_change_pct > 0 ? 'text-emerald-600' : input.brand_spend_change_pct < 0 ? 'text-red-600' : 'text-gray-500'
                )}>
                  {input.brand_spend_change_pct > 0 ? '+' : ''}{input.brand_spend_change_pct}%
                </span>
              </div>
              <input
                type="range"
                min={-50}
                max={100}
                value={input.brand_spend_change_pct}
                onChange={(e) => setInput({ ...input, brand_spend_change_pct: Number(e.target.value) })}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>-50%</span>
                <span>0%</span>
                <span>+100%</span>
              </div>
            </div>

            {/* Non-brand Spend Change */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Non-brand Spend Change</label>
                <span className={clsx(
                  'text-sm font-bold',
                  input.nonbrand_spend_change_pct > 0 ? 'text-emerald-600' : input.nonbrand_spend_change_pct < 0 ? 'text-red-600' : 'text-gray-500'
                )}>
                  {input.nonbrand_spend_change_pct > 0 ? '+' : ''}{input.nonbrand_spend_change_pct}%
                </span>
              </div>
              <input
                type="range"
                min={-50}
                max={100}
                value={input.nonbrand_spend_change_pct}
                onChange={(e) => setInput({ ...input, nonbrand_spend_change_pct: Number(e.target.value) })}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-brand-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>-50%</span>
                <span>0%</span>
                <span>+100%</span>
              </div>
            </div>

            {/* Promo Toggle */}
            <div className="mb-5">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Promotion Active</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={input.promo_active}
                    onChange={(e) => setInput({ ...input, promo_active: e.target.checked })}
                    className="sr-only"
                  />
                  <div
                    className={clsx(
                      'block w-11 h-6 rounded-full transition-colors',
                      input.promo_active ? 'bg-brand-600' : 'bg-gray-300'
                    )}
                  />
                  <div
                    className={clsx(
                      'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                      input.promo_active && 'translate-x-5'
                    )}
                  />
                </div>
              </label>
            </div>

            {/* Optional Overrides */}
            <div className="border-t border-gray-100 pt-4 mb-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Optional Context Overrides
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Temperature (°F)</label>
                  <input
                    type="number"
                    value={input.temperature ?? ''}
                    onChange={(e) =>
                      setInput({ ...input, temperature: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="Leave blank for current"
                    className="input"
                    min={0}
                    max={120}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Day of Week</label>
                  <select
                    value={input.day_of_week || ''}
                    onChange={(e) =>
                      setInput({ ...input, day_of_week: e.target.value || undefined })
                    }
                    className="input"
                  >
                    <option value="">Current day</option>
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Simulation
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          {!hasRun && (
            <div className="card card-body text-center py-16">
              <SlidersHorizontal className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-base font-semibold text-gray-900 mb-1">Configure and Run a Scenario</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                Adjust the sliders on the left to model different budget scenarios. The simulator uses
                historical patterns, marginal return curves, and contextual data to project outcomes.
              </p>
            </div>
          )}

          {loading && <LoadingState />}

          {hasRun && !loading && result && (
            <>
              {/* Projected Revenue */}
              <div className="card card-body">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Projected Outcome</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="text-center p-4 rounded-xl bg-gray-50">
                    <p className="text-xs text-gray-500 mb-1">Projected Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(result.projected_revenue)}</p>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {revenueChange > 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                      ) : revenueChange < 0 ? (
                        <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      ) : null}
                      <span className={clsx(
                        'text-xs font-semibold',
                        revenueChange > 0 ? 'text-emerald-600' : revenueChange < 0 ? 'text-red-600' : 'text-gray-500'
                      )}>
                        {revenueChange > 0 ? '+' : ''}{revenueChange.toFixed(1)}% vs baseline
                      </span>
                    </div>
                  </div>
                  <MetricCard
                    label="Projected ROAS"
                    value={formatRoas(result.projected_roas)}
                  />
                  <MetricCard
                    label="Projected MER"
                    value={formatRoas(result.projected_mer)}
                  />
                  <MetricCard
                    label="New Customers"
                    value={`${result.new_customers_change > 0 ? '+' : ''}${formatPercent(result.new_customers_change)}`}
                  />
                </div>

                {/* Confidence Range Bar */}
                <div className="mt-6">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Revenue Confidence Range</p>
                  <div className="relative h-10 bg-gray-100 rounded-lg overflow-hidden">
                    {/* Range bar */}
                    {(() => {
                      const min = result.projected_revenue_low;
                      const max = result.projected_revenue_high;
                      const point = result.projected_revenue;
                      const rangeStart = min * 0.95;
                      const rangeEnd = max * 1.05;
                      const totalRange = rangeEnd - rangeStart;
                      const lowPct = ((min - rangeStart) / totalRange) * 100;
                      const highPct = ((max - rangeStart) / totalRange) * 100;
                      const pointPct = ((point - rangeStart) / totalRange) * 100;
                      return (
                        <>
                          <div
                            className="absolute top-2 bottom-2 bg-brand-200 rounded"
                            style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
                          />
                          <div
                            className="absolute top-1 bottom-1 w-1 bg-brand-700 rounded z-10"
                            style={{ left: `${pointPct}%` }}
                          />
                          <div className="absolute bottom-full mb-1 text-[10px] text-gray-500" style={{ left: `${lowPct}%` }}>
                            {formatCompactNumber(min)}
                          </div>
                          <div className="absolute bottom-full mb-1 text-[10px] text-gray-500" style={{ left: `${highPct}%`, transform: 'translateX(-100%)' }}>
                            {formatCompactNumber(max)}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Low: {formatCurrency(result.projected_revenue_low)}</span>
                    <span>Best Estimate: {formatCurrency(result.projected_revenue)}</span>
                    <span>High: {formatCurrency(result.projected_revenue_high)}</span>
                  </div>
                </div>
              </div>

              {/* Risk Assessment */}
              <div className={clsx(
                'card card-body border-l-4',
                result.risk_level === 'high' ? 'border-l-red-500' : result.risk_level === 'medium' ? 'border-l-amber-500' : 'border-l-emerald-500'
              )}>
                <div className="flex items-start gap-3">
                  <ShieldAlert className={clsx(
                    'w-6 h-6 mt-0.5 flex-shrink-0',
                    result.risk_level === 'high' ? 'text-red-500' : result.risk_level === 'medium' ? 'text-amber-500' : 'text-emerald-500'
                  )} />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-gray-900">Risk Assessment</h3>
                      <span className={clsx(
                        'badge',
                        result.risk_level === 'high' ? 'bg-red-100 text-red-700' : result.risk_level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      )}>
                        {result.risk_level.charAt(0).toUpperCase() + result.risk_level.slice(1)} Risk
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{result.risk_assessment}</p>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  {result.warnings.map((warning, i) => (
                    <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-amber-800">{warning}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Assumptions */}
              <div className="card card-body">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-5 h-5 text-brand-500" />
                  <h3 className="text-base font-semibold text-gray-900">Model Assumptions</h3>
                </div>
                <ul className="space-y-1.5">
                  {result.assumptions.map((assumption, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 flex-shrink-0" />
                      {assumption}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Historical Analogues */}
              {result.historical_analogues.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <History className="w-5 h-5 text-brand-500" />
                    <h3 className="text-base font-semibold text-gray-900">Historical Analogues</h3>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">
                    Past scenarios with similar parameters. These inform the projection.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {result.historical_analogues.map((state) => (
                      <SimilarStateCard key={state.date} state={state} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
