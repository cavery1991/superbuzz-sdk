import { useState, useEffect, useCallback } from 'react';
import {
  FlaskConical,
  Plus,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import ExperimentCard from '@/components/cards/ExperimentCard';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import TimeSeriesChart from '@/components/charts/TimeSeriesChart';
import { fetchExperiments, createExperiment } from '@/services/api';
import { formatPercent } from '@/utils/format';
import type { Experiment } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

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
    configuration: { regions: ['CA', 'OR', 'WA'] },
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
    configuration: { budget_change_pct: 25 },
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
  {
    id: '4',
    name: 'Geo Holdout - Midwest',
    type: 'geo_holdout',
    status: 'completed',
    treatment_description: 'Paused brand ads in IL, OH, MI',
    control_description: 'Normal brand spend in remaining states',
    start_date: '2026-01-15',
    end_date: '2026-02-05',
    configuration: { regions: ['IL', 'OH', 'MI'] },
    results: {
      lift_pct: 4.7,
      confidence_interval: [-1.2, 10.6],
      p_value: 0.12,
      is_significant: false,
      treatment_metric: 38200,
      control_metric: 40000,
      treatment_data: Array.from({ length: 21 }, (_, i) => ({
        date: `2026-01-${String(i + 15).padStart(2, '0')}`,
        value: 1700 + Math.random() * 500,
      })),
      control_data: Array.from({ length: 21 }, (_, i) => ({
        date: `2026-01-${String(i + 15).padStart(2, '0')}`,
        value: 1800 + Math.random() * 500,
      })),
    },
    created_at: '2026-01-10',
  },
];

type ExperimentType = 'geo_holdout' | 'time_holdout' | 'budget_shift';

interface NewExperimentForm {
  name: string;
  type: ExperimentType;
  treatment_description: string;
  control_description: string;
  start_date: string;
  end_date: string;
}

const EMPTY_FORM: NewExperimentForm = {
  name: '',
  type: 'geo_holdout',
  treatment_description: '',
  control_description: '',
  start_date: '',
  end_date: '',
};

const TYPE_OPTIONS: { value: ExperimentType; label: string; description: string }[] = [
  {
    value: 'geo_holdout',
    label: 'Geo Holdout',
    description: 'Pause ads in specific geographic regions while maintaining them in others.',
  },
  {
    value: 'time_holdout',
    label: 'Time Holdout',
    description: 'Alternate between ads-on and ads-off periods to measure incremental lift.',
  },
  {
    value: 'budget_shift',
    label: 'Budget Shift',
    description: 'Shift budget between brand and non-brand to measure marginal impact.',
  },
];

// ──────────────────────────────── Component ────────────────────────────────

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>(DEMO_EXPERIMENTS);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewExperimentForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchExperiments()
      .then((data) => {
        if (!cancelled && data.length > 0) setExperiments(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const handleCreate = useCallback(() => {
    if (!form.name || !form.start_date || !form.end_date) return;
    setCreating(true);

    createExperiment({
      name: form.name,
      type: form.type,
      status: 'draft',
      treatment_description: form.treatment_description,
      control_description: form.control_description,
      start_date: form.start_date,
      end_date: form.end_date,
      configuration: {},
    })
      .then((newExp) => {
        setExperiments((prev) => [newExp, ...prev]);
        setShowForm(false);
        setForm(EMPTY_FORM);
      })
      .catch(() => {
        // Add locally for demo
        const demoExp: Experiment = {
          id: String(Date.now()),
          ...form,
          status: 'draft',
          configuration: {},
          created_at: new Date().toISOString(),
        };
        setExperiments((prev) => [demoExp, ...prev]);
        setShowForm(false);
        setForm(EMPTY_FORM);
      })
      .finally(() => setCreating(false));
  }, [form]);

  const active = experiments.filter((e) => e.status === 'running');
  const completed = experiments.filter((e) => e.status === 'completed');
  const drafts = experiments.filter((e) => e.status === 'draft');
  const viewingResult = completed.find((e) => e.id === selectedResult);

  if (loading) {
    return (
      <PageLayout title="Experiments" subtitle="Measure true incremental impact through controlled tests">
        <LoadingState variant="cards" count={4} />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Experiments" subtitle="Measure true incremental impact through controlled tests">
      {/* Summary */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-gray-600">Running: {active.length}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-gray-600">Completed: {completed.length}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
            <span className="text-gray-600">Drafts: {drafts.length}</span>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Design New Experiment'}
        </button>
      </section>

      {/* New Experiment Form */}
      {showForm && (
        <section className="card card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Design New Experiment</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Experiment Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Brand Holdout - East Coast"
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Experiment Type</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setForm({ ...form, type: opt.value })}
                    className={clsx(
                      'rounded-lg border p-4 text-left transition-all',
                      form.type === opt.value
                        ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <p className={clsx(
                      'text-sm font-semibold',
                      form.type === opt.value ? 'text-brand-700' : 'text-gray-900'
                    )}>
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{opt.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Treatment Description</label>
                <textarea
                  value={form.treatment_description}
                  onChange={(e) => setForm({ ...form, treatment_description: e.target.value })}
                  placeholder="Describe what changes in the treatment group..."
                  className="input min-h-[80px]"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Control Description</label>
                <textarea
                  value={form.control_description}
                  onChange={(e) => setForm({ ...form, control_description: e.target.value })}
                  placeholder="Describe the control/baseline group..."
                  className="input min-h-[80px]"
                  rows={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.name || !form.start_date || !form.end_date}
                className="btn-primary flex items-center gap-2"
              >
                {creating ? <Clock className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                {creating ? 'Creating...' : 'Create Experiment'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Active Experiments */}
      {active.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            Active Experiments
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {active.map((exp) => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))}
          </div>
        </section>
      )}

      {/* Completed Experiments */}
      {completed.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            Completed Experiments
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {completed.map((exp) => (
              <div key={exp.id}>
                <div
                  onClick={() => setSelectedResult(selectedResult === exp.id ? null : exp.id)}
                  className="cursor-pointer"
                >
                  <ExperimentCard experiment={exp} />
                </div>
              </div>
            ))}
          </div>

          {/* Results Viewer */}
          {viewingResult?.results && (
            <div className="mt-4 card card-body border-l-4 border-l-brand-500">
              <h4 className="text-base font-semibold text-gray-900 mb-4">
                Results: {viewingResult.name}
              </h4>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
                <div className="text-center p-3 rounded-lg bg-gray-50">
                  <p className="text-xs text-gray-500">Measured Lift</p>
                  <p className={clsx(
                    'text-2xl font-bold',
                    viewingResult.results.lift_pct > 0 ? 'text-emerald-600' : 'text-red-600'
                  )}>
                    {viewingResult.results.lift_pct > 0 ? '+' : ''}{formatPercent(viewingResult.results.lift_pct)}
                  </p>
                </div>
                <div className="text-center p-3 rounded-lg bg-gray-50">
                  <p className="text-xs text-gray-500">Confidence Interval</p>
                  <p className="text-sm font-semibold text-gray-700 mt-1">
                    [{formatPercent(viewingResult.results.confidence_interval[0])} to{' '}
                    {formatPercent(viewingResult.results.confidence_interval[1])}]
                  </p>
                </div>
                <div className="text-center p-3 rounded-lg bg-gray-50">
                  <p className="text-xs text-gray-500">p-value</p>
                  <p className="text-lg font-bold text-gray-900">{viewingResult.results.p_value.toFixed(4)}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-gray-50">
                  <p className="text-xs text-gray-500">Statistically Significant?</p>
                  <div className="mt-1">
                    <ConfidenceBadge level={viewingResult.results.is_significant ? 'high' : 'low'} />
                  </div>
                </div>
              </div>

              {/* Confidence interval visual */}
              <div className="mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Lift Confidence Range</p>
                <div className="relative h-8 bg-gray-100 rounded-lg">
                  {/* Zero line */}
                  <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-300 z-10" />
                  {/* CI bar */}
                  {(() => {
                    const range = 40; // -20% to +20% scale
                    const ciLow = viewingResult.results!.confidence_interval[0];
                    const ciHigh = viewingResult.results!.confidence_interval[1];
                    const leftPct = Math.max(0, ((ciLow + range / 2) / range) * 100);
                    const rightPct = Math.min(100, ((ciHigh + range / 2) / range) * 100);
                    const pointPct = ((viewingResult.results!.lift_pct + range / 2) / range) * 100;
                    return (
                      <>
                        <div
                          className={clsx(
                            'absolute top-1 bottom-1 rounded',
                            viewingResult.results!.is_significant ? 'bg-emerald-300' : 'bg-amber-300'
                          )}
                          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-1 bg-gray-900 rounded z-20"
                          style={{ left: `${pointPct}%` }}
                        />
                      </>
                    );
                  })()}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 text-[10px] text-gray-400">
                    0%
                  </div>
                </div>
              </div>

              {/* Treatment vs Control chart */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Treatment vs Control Over Time</p>
                <TimeSeriesChart
                  data={viewingResult.results.treatment_data.map((td, i) => ({
                    date: td.date.slice(5),
                    Treatment: Math.round(td.value),
                    Control: Math.round(viewingResult.results!.control_data[i]?.value || 0),
                  }))}
                  xKey="date"
                  lines={[
                    { dataKey: 'Treatment', name: 'Treatment', color: '#3399FF' },
                    { dataKey: 'Control', name: 'Control', color: '#9CA3AF' },
                  ]}
                  height={250}
                />
              </div>

              {/* Interpretation */}
              <div className="mt-4 rounded-lg bg-gray-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-brand-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Interpretation</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {viewingResult.results.is_significant
                        ? `The experiment detected a statistically significant lift of ${formatPercent(viewingResult.results.lift_pct)}. The true lift is likely between ${formatPercent(viewingResult.results.confidence_interval[0])} and ${formatPercent(viewingResult.results.confidence_interval[1])} (95% CI). This provides strong evidence for the treatment effect.`
                        : `The experiment did not reach statistical significance (p=${viewingResult.results.p_value.toFixed(3)}). While a lift of ${formatPercent(viewingResult.results.lift_pct)} was observed, the confidence interval includes zero, meaning we cannot rule out no effect. Consider running a longer experiment or with larger sample sizes.`
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Draft Experiments */}
      {drafts.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-4">Draft Experiments</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {drafts.map((exp) => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state if no experiments */}
      {experiments.length === 0 && (
        <EmptyState
          title="No experiments yet"
          description="Design your first experiment to start measuring the true incremental impact of your ad spend."
          icon={<FlaskConical className="w-8 h-8" />}
          action={
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Design First Experiment
            </button>
          }
        />
      )}
    </PageLayout>
  );
}
