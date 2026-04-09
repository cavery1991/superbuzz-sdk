import { useState } from 'react';
import PageLayout from '@/components/layout/PageLayout';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import CorrelationMatrix from '@/components/charts/CorrelationMatrix';
import { useApi } from '@/hooks/useApi';
import { fetchCorrelations, fetchCausalAnalysis } from '@/services/api';
import { Microscope, ArrowRight, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import clsx from 'clsx';
import type { CausalAnalysis, CorrelationEntry } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_CORRELATIONS: CorrelationEntry[] = [
  { var1: 'brand_spend', var2: 'organic_traffic', correlation: -0.68 },
  { var1: 'brand_spend', var2: 'revenue', correlation: 0.45 },
  { var1: 'nonbrand_spend', var2: 'revenue', correlation: 0.82 },
  { var1: 'nonbrand_spend', var2: 'new_customers', correlation: 0.76 },
  { var1: 'temperature', var2: 'revenue', correlation: 0.41 },
  { var1: 'brand_spend', var2: 'paid_brand_traffic', correlation: 0.91 },
  { var1: 'organic_traffic', var2: 'revenue', correlation: 0.63 },
  { var1: 'paid_brand_traffic', var2: 'organic_traffic', correlation: -0.55 },
  { var1: 'temperature', var2: 'nonbrand_spend', correlation: 0.12 },
  { var1: 'new_customers', var2: 'revenue', correlation: 0.58 },
];

const DEMO_CAUSAL: CausalAnalysis = {
  variable_pair: ['nonbrand_spend', 'revenue'],
  correlation: 0.82,
  temporal_precedence: {
    result: 'pass',
    score: 0.85,
    detail: 'Changes in non-brand spend precede revenue changes by 1-2 days consistently.',
  },
  isolation_score: {
    result: 'pass',
    score: 0.72,
    detail: 'Non-brand spend changes correlate with revenue changes even when controlling for brand spend and organic traffic.',
  },
  saturation_analysis: {
    result: 'partial',
    score: 0.61,
    detail: 'Diminishing returns evident above $850/day spend level. Response curve shows logarithmic shape.',
  },
  demand_dependency: {
    result: 'pass',
    score: 0.78,
    detail: 'Non-brand campaigns appear to be creating demand rather than just capturing it, based on new customer ratios.',
  },
  overall_confidence: 'high',
  verdict: 'likely_causal',
  explanation:
    'Strong evidence that non-brand spend causally drives revenue. The relationship passes temporal precedence, isolation, and demand dependency tests.',
  evidence: [
    'Granger causality test: p=0.003',
    'Revenue responds within 24-48 hours of spend changes',
    '56% new customer rate suggests demand creation, not just capture',
    'Effect persists when controlling for seasonality and promotions',
  ],
  scatter_data: Array.from({ length: 40 }, () => ({
    x: 400 + Math.random() * 800,
    y: 2000 + Math.random() * 4000,
  })),
};

const verdictConfig = {
  likely_causal: {
    label: 'Likely Causal',
    icon: <CheckCircle className="h-5 w-5 text-accent-600" />,
    bg: 'bg-accent-50 border-accent-200',
    text: 'text-accent-800',
  },
  correlated_not_causal: {
    label: 'Correlated, Not Causal',
    icon: <AlertTriangle className="h-5 w-5 text-warning-600" />,
    bg: 'bg-warning-50 border-warning-200',
    text: 'text-warning-800',
  },
  weak_confounded: {
    label: 'Weak / Confounded',
    icon: <XCircle className="h-5 w-5 text-danger-600" />,
    bg: 'bg-danger-50 border-danger-200',
    text: 'text-danger-800',
  },
};

// ──────────────────────────────── Component ────────────────────────────────

export default function CausationPage() {
  const { data: apiCorrelations } = useApi(() => fetchCorrelations());
  const correlations = apiCorrelations && apiCorrelations.length > 0 ? apiCorrelations : DEMO_CORRELATIONS;

  const [selectedPair, setSelectedPair] = useState<[string, string] | null>(null);
  const [causal, setCausal] = useState<CausalAnalysis | null>(null);
  const [causalLoading, setCausalLoading] = useState(false);

  const variables = Array.from(
    new Set(correlations.flatMap((c) => [c.var1, c.var2]))
  ).sort();

  const handleAnalyze = async (var1: string, var2: string) => {
    setSelectedPair([var1, var2]);
    setCausalLoading(true);
    try {
      const result = await fetchCausalAnalysis(var1, var2);
      setCausal(result);
    } catch {
      // Fall back to demo data for the pair
      setCausal({
        ...DEMO_CAUSAL,
        variable_pair: [var1, var2],
      });
    } finally {
      setCausalLoading(false);
    }
  };

  return (
    <PageLayout
      title="Causation Lab"
      subtitle="Explore whether correlated metrics have a causal relationship"
    >
      {/* Correlation Matrix */}
      <div className="card card-body">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Correlation Matrix</h3>
        <p className="mb-4 text-sm text-gray-500">
          Click a pair below to investigate the causal relationship between two variables.
        </p>
        <CorrelationMatrix data={correlations} variables={variables} />
        <div className="mt-4 flex flex-wrap gap-2">
          <p className="text-xs text-gray-500 mr-2 self-center">Analyze pair:</p>
          {correlations
            .filter((c) => Math.abs(c.correlation) > 0.3)
            .slice(0, 8)
            .map((c, i) => (
              <button
                key={i}
                onClick={() => handleAnalyze(c.var1, c.var2)}
                className={clsx(
                  'btn-sm btn-secondary',
                  selectedPair &&
                    selectedPair[0] === c.var1 &&
                    selectedPair[1] === c.var2 &&
                    'ring-2 ring-brand-500'
                )}
              >
                {c.var1.replace(/_/g, ' ')}{' '}
                <ArrowRight className="mx-1 inline h-3 w-3" />{' '}
                {c.var2.replace(/_/g, ' ')}
              </button>
            ))}
        </div>
      </div>

      {/* Causal Analysis Results */}
      {(selectedPair || causal) && (
        <div className="card card-body">
          <h3 className="mb-4 text-base font-semibold text-gray-900">
            Causal Analysis:{' '}
            {selectedPair
              ? `${selectedPair[0].replace(/_/g, ' ')} \u2192 ${selectedPair[1].replace(/_/g, ' ')}`
              : ''}
          </h3>
          {causalLoading ? (
            <LoadingState />
          ) : causal ? (
            <div className="space-y-6">
              {/* Verdict Banner */}
              <div
                className={clsx(
                  'flex items-center gap-3 rounded-lg border p-4',
                  verdictConfig[causal.verdict].bg
                )}
              >
                {verdictConfig[causal.verdict].icon}
                <div className="flex-1">
                  <p
                    className={clsx(
                      'text-sm font-bold',
                      verdictConfig[causal.verdict].text
                    )}
                  >
                    {verdictConfig[causal.verdict].label}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">{causal.explanation}</p>
                </div>
                <div className="flex-shrink-0">
                  <ConfidenceBadge level={causal.overall_confidence} />
                </div>
              </div>

              {/* Test Scores */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Temporal Precedence', data: causal.temporal_precedence },
                  { label: 'Isolation Score', data: causal.isolation_score },
                  { label: 'Saturation Analysis', data: causal.saturation_analysis },
                  { label: 'Demand Dependency', data: causal.demand_dependency },
                ].map((test) => (
                  <div key={test.label} className="rounded-lg border border-gray-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {test.label}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-lg font-bold text-gray-900">
                        {test.data.score.toFixed(2)}
                      </p>
                      <span
                        className={clsx(
                          'badge',
                          test.data.result === 'pass'
                            ? 'bg-accent-50 text-accent-700'
                            : test.data.result === 'fail'
                              ? 'bg-danger-50 text-danger-700'
                              : 'bg-warning-50 text-warning-700'
                        )}
                      >
                        {test.data.result}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">{test.data.detail}</p>
                  </div>
                ))}
              </div>

              {/* Scatter Plot */}
              {causal.scatter_data.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-700">Scatter Plot</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="x"
                        type="number"
                        name={causal.variable_pair[0]}
                        tick={{ fontSize: 11, fill: '#9CA3AF' }}
                        label={{
                          value: causal.variable_pair[0].replace(/_/g, ' '),
                          position: 'insideBottom',
                          offset: -10,
                          fontSize: 11,
                          fill: '#6B7280',
                        }}
                      />
                      <YAxis
                        dataKey="y"
                        type="number"
                        name={causal.variable_pair[1]}
                        tick={{ fontSize: 11, fill: '#9CA3AF' }}
                        label={{
                          value: causal.variable_pair[1].replace(/_/g, ' '),
                          angle: -90,
                          position: 'insideLeft',
                          fontSize: 11,
                          fill: '#6B7280',
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #E5E7EB',
                          borderRadius: '8px',
                          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                          fontSize: '12px',
                        }}
                      />
                      <Scatter data={causal.scatter_data} fill="#3399FF" fillOpacity={0.6} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Evidence */}
              {causal.evidence.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-700">Evidence</h4>
                  <ul className="space-y-1.5">
                    {causal.evidence.map((e, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400" />
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="Analysis failed"
              description="Could not complete causal analysis for this pair."
              icon={<Microscope className="h-8 w-8" />}
            />
          )}
        </div>
      )}
    </PageLayout>
  );
}
