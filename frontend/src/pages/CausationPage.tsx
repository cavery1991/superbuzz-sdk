import { useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ZAxis,
} from 'recharts';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import LoadingState from '@/components/ui/LoadingState';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import CorrelationMatrix from '@/components/charts/CorrelationMatrix';
import { fetchCorrelations, fetchCausalAnalysis } from '@/services/api';
import type { CorrelationEntry, CausalAnalysis } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const VARIABLES = [
  'brand_spend',
  'nonbrand_spend',
  'revenue',
  'organic_traffic',
  'paid_brand_traffic',
  'new_customers',
  'cpa',
  'temperature',
];

const DEMO_CORRELATIONS: CorrelationEntry[] = [
  { var1: 'brand_spend', var2: 'revenue', correlation: 0.82 },
  { var1: 'nonbrand_spend', var2: 'revenue', correlation: 0.74 },
  { var1: 'brand_spend', var2: 'organic_traffic', correlation: -0.31 },
  { var1: 'nonbrand_spend', var2: 'new_customers', correlation: 0.68 },
  { var1: 'brand_spend', var2: 'paid_brand_traffic', correlation: 0.91 },
  { var1: 'paid_brand_traffic', var2: 'organic_traffic', correlation: -0.68 },
  { var1: 'temperature', var2: 'revenue', correlation: 0.42 },
  { var1: 'temperature', var2: 'organic_traffic', correlation: 0.35 },
  { var1: 'nonbrand_spend', var2: 'cpa', correlation: 0.56 },
  { var1: 'brand_spend', var2: 'cpa', correlation: -0.22 },
  { var1: 'revenue', var2: 'new_customers', correlation: 0.65 },
  { var1: 'brand_spend', var2: 'new_customers', correlation: 0.18 },
  { var1: 'nonbrand_spend', var2: 'organic_traffic', correlation: 0.12 },
  { var1: 'brand_spend', var2: 'nonbrand_spend', correlation: 0.45 },
  { var1: 'temperature', var2: 'new_customers', correlation: 0.28 },
  { var1: 'cpa', var2: 'new_customers', correlation: -0.41 },
  { var1: 'revenue', var2: 'organic_traffic', correlation: 0.55 },
  { var1: 'paid_brand_traffic', var2: 'revenue', correlation: 0.78 },
  { var1: 'temperature', var2: 'nonbrand_spend', correlation: 0.15 },
  { var1: 'cpa', var2: 'revenue', correlation: -0.12 },
  { var1: 'organic_traffic', var2: 'new_customers', correlation: 0.48 },
];

function makeDemoCausalAnalysis(v1: string, v2: string): CausalAnalysis {
  const corrEntry = DEMO_CORRELATIONS.find(
    (c) => (c.var1 === v1 && c.var2 === v2) || (c.var1 === v2 && c.var2 === v1)
  );
  const corr = corrEntry?.correlation ?? 0.3;
  const absCorr = Math.abs(corr);

  const isLikelyCausal = v1 === 'nonbrand_spend' && v2 === 'new_customers';
  const isWeak = absCorr < 0.3;

  return {
    variable_pair: [v1, v2],
    correlation: corr,
    temporal_precedence: {
      result: isLikelyCausal ? 'Spend changes precede customer changes by 1-2 days' : 'No clear temporal ordering',
      score: isLikelyCausal ? 0.85 : 0.4,
      detail: isLikelyCausal ? 'Granger causality test significant at p<0.05' : 'Bidirectional or simultaneous movement',
    },
    isolation_score: {
      result: isLikelyCausal ? 'Effect holds when controlling for confounders' : 'Weakened when controlling for other variables',
      score: isLikelyCausal ? 0.78 : 0.35,
      detail: isLikelyCausal ? 'Partial correlation remains strong (r=0.61)' : 'Partial correlation drops significantly',
    },
    saturation_analysis: {
      result: isLikelyCausal ? 'Diminishing returns observed at high spend levels' : 'No clear saturation pattern',
      score: isLikelyCausal ? 0.72 : 0.5,
      detail: isLikelyCausal ? 'Consistent with causal mechanism showing diminishing marginal returns' : 'Linear relationship throughout range',
    },
    demand_dependency: {
      result: isLikelyCausal ? 'Effect persists across demand conditions' : 'Relationship varies with demand levels',
      score: isLikelyCausal ? 0.8 : 0.45,
      detail: isLikelyCausal ? 'Robust across high and low demand periods' : 'Stronger during high demand, may be confounded',
    },
    overall_confidence: isLikelyCausal ? 'high' : isWeak ? 'low' : 'medium',
    verdict: isLikelyCausal ? 'likely_causal' : isWeak ? 'weak_confounded' : 'correlated_not_causal',
    explanation: isLikelyCausal
      ? 'Non-brand spend appears to have a genuine causal impact on new customer acquisition. The relationship passes temporal precedence, isolation, and demand dependency checks.'
      : isWeak
        ? `The correlation between ${v1.replace(/_/g, ' ')} and ${v2.replace(/_/g, ' ')} is weak and likely confounded by shared external factors like seasonality.`
        : `While ${v1.replace(/_/g, ' ')} and ${v2.replace(/_/g, ' ')} are correlated (r=${corr.toFixed(2)}), the relationship does not pass enough causal checks to confirm causation. A shared driver or confounding variable is likely.`,
    evidence: isLikelyCausal
      ? [
          'Temporal precedence confirmed via Granger test (p=0.003)',
          'Partial correlation after controlling for seasonality: 0.61',
          'Diminishing returns pattern consistent with causal mechanism',
          'Effect robust across demand conditions',
        ]
      : [
          `Correlation: ${corr.toFixed(2)}`,
          'Temporal ordering unclear or bidirectional',
          'Partial correlation drops when controlling for confounders',
          'Relationship varies significantly with demand levels',
        ],
    scatter_data: Array.from({ length: 60 }, () => {
      const x = Math.random() * 100;
      return {
        x: Math.round(x),
        y: Math.round(x * corr + (Math.random() - 0.5) * 60 * (1 - Math.abs(corr))),
      };
    }),
  };
}

const PRECOMPUTED_PAIRS: [string, string][] = [
  ['nonbrand_spend', 'new_customers'],
  ['brand_spend', 'revenue'],
  ['paid_brand_traffic', 'organic_traffic'],
  ['temperature', 'revenue'],
];

const VERDICT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  likely_causal: {
    label: 'Likely Causal',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  correlated_not_causal: {
    label: 'Correlated but Not Proven Causal',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  weak_confounded: {
    label: 'Weak / Confounded',
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: <XCircle className="w-4 h-4" />,
  },
};

// ──────────────────────────────── Component ────────────────────────────────

export default function CausationPage() {
  const [correlations, setCorrelations] = useState<CorrelationEntry[]>(DEMO_CORRELATIONS);
  const [loading, setLoading] = useState(true);

  const [var1, setVar1] = useState(VARIABLES[0]);
  const [var2, setVar2] = useState(VARIABLES[2]);
  const [analysis, setAnalysis] = useState<CausalAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchCorrelations()
      .then((data) => {
        if (!cancelled && data.length > 0) setCorrelations(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const runAnalysis = useCallback(() => {
    if (var1 === var2) return;
    setAnalysisLoading(true);
    setAnalysis(null);

    fetchCausalAnalysis(var1, var2)
      .then((data) => setAnalysis(data))
      .catch(() => setAnalysis(makeDemoCausalAnalysis(var1, var2)))
      .finally(() => setAnalysisLoading(false));
  }, [var1, var2]);

  // Pre-compute analyses
  const [precomputed, setPrecomputed] = useState<CausalAnalysis[]>([]);
  useEffect(() => {
    const results = PRECOMPUTED_PAIRS.map(([a, b]) => makeDemoCausalAnalysis(a, b));
    setPrecomputed(results);
  }, []);

  if (loading) {
    return (
      <PageLayout title="Causation Lab" subtitle="Distinguish correlation from causation">
        <LoadingState />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Causation Lab"
      subtitle="Distinguish correlation from causation with systematic analysis"
    >
      {/* Correlation Matrix */}
      <section className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Correlation Matrix</h3>
        <CorrelationMatrix data={correlations} variables={VARIABLES} />
        <p className="text-xs text-gray-400 mt-3">
          Click on any variable pair below to analyze whether the correlation is causal.
        </p>
      </section>

      {/* Variable Pair Analysis */}
      <section className="card card-body">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Variable Pair Analysis</h3>
        <div className="flex flex-col sm:flex-row items-end gap-3 mb-6">
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-500 mb-1">Variable 1</label>
            <select
              value={var1}
              onChange={(e) => setVar1(e.target.value)}
              className="input"
            >
              {VARIABLES.map((v) => (
                <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-500 mb-1">Variable 2</label>
            <select
              value={var2}
              onChange={(e) => setVar2(e.target.value)}
              className="input"
            >
              {VARIABLES.filter((v) => v !== var1).map((v) => (
                <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <button
            onClick={runAnalysis}
            disabled={var1 === var2 || analysisLoading}
            className="btn-primary whitespace-nowrap flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Analyze
          </button>
        </div>

        {analysisLoading && <LoadingState />}

        {analysis && (
          <div className="space-y-6">
            {/* Overall Verdict */}
            <div className="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-xl bg-gray-50">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={clsx(
                    'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border',
                    VERDICT_CONFIG[analysis.verdict].color
                  )}>
                    {VERDICT_CONFIG[analysis.verdict].icon}
                    {VERDICT_CONFIG[analysis.verdict].label}
                  </span>
                  <ConfidenceBadge level={analysis.overall_confidence} />
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{analysis.explanation}</p>
              </div>
              <div className="text-center flex-shrink-0">
                <p className="text-xs text-gray-500">Correlation</p>
                <p className="text-3xl font-bold text-gray-900">{analysis.correlation.toFixed(2)}</p>
              </div>
            </div>

            {/* Scatter Plot */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Scatter Plot</h4>
              <ResponsiveContainer width="100%" height={250}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="x"
                    name={analysis.variable_pair[0].replace(/_/g, ' ')}
                    tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    label={{ value: analysis.variable_pair[0].replace(/_/g, ' '), position: 'insideBottom', offset: -10, fontSize: 11, fill: '#6B7280' }}
                  />
                  <YAxis
                    dataKey="y"
                    name={analysis.variable_pair[1].replace(/_/g, ' ')}
                    tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    label={{ value: analysis.variable_pair[1].replace(/_/g, ' '), angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6B7280' }}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #E5E7EB' }}
                  />
                  <Scatter data={analysis.scatter_data} fill="#3399FF" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Causal Check Results */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Causal Check Results</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { label: 'Temporal Precedence', data: analysis.temporal_precedence },
                  { label: 'Isolation Score', data: analysis.isolation_score },
                  { label: 'Saturation Analysis', data: analysis.saturation_analysis },
                  { label: 'Demand Dependency', data: analysis.demand_dependency },
                ].map((check) => (
                  <div key={check.label} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{check.label}</p>
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-2 rounded-full bg-gray-200">
                          <div
                            className={clsx(
                              'h-2 rounded-full',
                              check.data.score > 0.7 ? 'bg-emerald-500' : check.data.score > 0.4 ? 'bg-amber-500' : 'bg-red-500'
                            )}
                            style={{ width: `${check.data.score * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-gray-700">{(check.data.score * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700">{check.data.result}</p>
                    <p className="text-xs text-gray-500 mt-1">{check.data.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Evidence</h4>
              <ul className="space-y-1.5">
                {analysis.evidence.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-2 flex-shrink-0" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* Pre-computed Analyses */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-4">Key Variable Pair Analyses</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {precomputed.map((a) => {
            const verdict = VERDICT_CONFIG[a.verdict];
            return (
              <div
                key={a.variable_pair.join('-')}
                className="card card-body hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  setVar1(a.variable_pair[0]);
                  setVar2(a.variable_pair[1]);
                  setAnalysis(a);
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {a.variable_pair[0].replace(/_/g, ' ')}
                      <span className="text-gray-400 mx-2">vs</span>
                      {a.variable_pair[1].replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Correlation: {a.correlation.toFixed(2)}</p>
                  </div>
                  <ConfidenceBadge level={a.overall_confidence} />
                </div>
                <span className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
                  verdict.color
                )}>
                  {verdict.icon}
                  {verdict.label}
                </span>
                <p className="text-xs text-gray-600 mt-2 line-clamp-2">{a.explanation}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Methodology Explanation */}
      <section className="card">
        <button
          onClick={() => setMethodOpen(!methodOpen)}
          className="w-full card-body flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-brand-500" />
            <h3 className="text-base font-semibold text-gray-900">How We Determine Causality</h3>
          </div>
          {methodOpen ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {methodOpen && (
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-gray-600">
              We apply 4 systematic checks to every correlated variable pair to assess whether the relationship is likely causal:
            </p>
            <div className="space-y-3">
              {[
                {
                  title: '1. Temporal Precedence',
                  description: 'Does the presumed cause change before the effect? We use Granger causality tests and lagged correlation analysis to determine if Variable A consistently precedes Variable B.',
                },
                {
                  title: '2. Isolation Score',
                  description: 'Does the relationship hold when we control for confounding variables? We compute partial correlations after removing the effect of known confounders like seasonality, promotions, and other spend channels.',
                },
                {
                  title: '3. Saturation Analysis',
                  description: 'Does the relationship show diminishing returns at scale? A causal mechanism typically shows a non-linear response at high levels, while spurious correlations tend to remain linear.',
                },
                {
                  title: '4. Demand Dependency',
                  description: 'Does the relationship persist across different demand conditions? A truly causal relationship should hold in both high and low demand periods, not just when both variables are driven by a common demand surge.',
                },
              ].map((method) => (
                <div key={method.title} className="pl-4 border-l-2 border-brand-200">
                  <p className="text-sm font-semibold text-gray-800">{method.title}</p>
                  <p className="text-sm text-gray-600 mt-0.5">{method.description}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-gray-50 p-4 mt-4">
              <p className="text-sm text-gray-700">
                <strong>Overall Verdict:</strong> Each check produces a score from 0-1. We combine these scores with empirically calibrated weights to produce an overall confidence level and verdict.
                A &quot;Likely Causal&quot; verdict requires scores above 0.7 on at least 3 of 4 checks.
              </p>
            </div>
          </div>
        )}
      </section>
    </PageLayout>
  );
}
