import { useState } from 'react';
import PageLayout from '@/components/layout/PageLayout';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import { useApi } from '@/hooks/useApi';
import {
  fetchBrandKeywords,
  addBrandKeyword,
  deleteBrandKeyword,
  fetchClassificationRules,
  addClassificationRule,
  updateClassificationRule,
  deleteClassificationRule,
  fetchSearchTermCoverage,
} from '@/services/api';
import { Settings, Plus, Trash2, Tag, FileText, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import { formatPercent, formatNumber } from '@/utils/format';
import type { BrandKeyword, ClassificationRule } from '@/types';

type AdminTab = 'keywords' | 'rules' | 'coverage';

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('keywords');

  return (
    <PageLayout
      title="Admin"
      subtitle="Manage brand keywords, classification rules, and search term coverage"
    >
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
        {([
          { id: 'keywords' as AdminTab, label: 'Brand Keywords', icon: <Tag className="h-3.5 w-3.5" /> },
          { id: 'rules' as AdminTab, label: 'Classification Rules', icon: <FileText className="h-3.5 w-3.5" /> },
          { id: 'coverage' as AdminTab, label: 'Coverage', icon: <BarChart3 className="h-3.5 w-3.5" /> },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              tab === t.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'keywords' && <KeywordsTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'coverage' && <CoverageTab />}
    </PageLayout>
  );
}

function KeywordsTab() {
  const { data: keywords, loading, refetch } = useApi(() => fetchBrandKeywords());
  const [newKeyword, setNewKeyword] = useState('');
  const [newMatchType, setNewMatchType] = useState<BrandKeyword['match_type']>('exact');
  const [newClassification, setNewClassification] = useState<BrandKeyword['classification']>('brand');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    try {
      await addBrandKeyword({
        keyword: newKeyword.trim(),
        match_type: newMatchType,
        classification: newClassification,
      });
      setNewKeyword('');
      refetch();
    } catch {
      // handle silently
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBrandKeyword(id);
      refetch();
    } catch {
      // handle silently
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Keyword Form */}
      <div className="card card-body">
        <h4 className="mb-3 text-sm font-semibold text-gray-900">Add Keyword</h4>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-700">Keyword</label>
            <input
              className="input"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g., superbuzz"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-gray-700">Match Type</label>
            <select
              className="input"
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value as BrandKeyword['match_type'])}
            >
              <option value="exact">Exact</option>
              <option value="phrase">Phrase</option>
              <option value="broad">Broad</option>
            </select>
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs font-medium text-gray-700">Classification</label>
            <select
              className="input"
              value={newClassification}
              onChange={(e) =>
                setNewClassification(e.target.value as BrandKeyword['classification'])
              }
            >
              <option value="brand">Brand</option>
              <option value="nonbrand">Non-brand</option>
              <option value="competitor">Competitor</option>
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !newKeyword.trim()}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      {/* Keywords Table */}
      {loading ? (
        <LoadingState variant="skeleton" count={3} />
      ) : keywords && keywords.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Keyword
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Match Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Classification
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {keywords.map((kw) => (
                <tr key={kw.id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-900">
                    {kw.keyword}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    <span className="badge bg-gray-100 text-gray-600">{kw.match_type}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    <span
                      className={clsx(
                        'badge',
                        kw.classification === 'brand' && 'bg-brand-50 text-brand-700',
                        kw.classification === 'nonbrand' && 'bg-accent-50 text-accent-700',
                        kw.classification === 'competitor' && 'bg-warning-50 text-warning-700'
                      )}
                    >
                      {kw.classification}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <button
                      onClick={() => handleDelete(kw.id)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No brand keywords"
          description="Add keywords to classify your search terms."
          icon={<Settings className="h-8 w-8" />}
        />
      )}
    </div>
  );
}

function RulesTab() {
  const { data: rules, loading, refetch } = useApi(() => fetchClassificationRules());
  const [newPattern, setNewPattern] = useState('');
  const [newMatchType, setNewMatchType] = useState<ClassificationRule['match_type']>('contains');
  const [newClassification, setNewClassification] = useState<ClassificationRule['classification']>('brand');
  const [newPriority, setNewPriority] = useState(10);
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newPattern.trim()) return;
    setAdding(true);
    try {
      await addClassificationRule({
        pattern: newPattern.trim(),
        match_type: newMatchType,
        classification: newClassification,
        priority: newPriority,
        active: true,
      });
      setNewPattern('');
      refetch();
    } catch {
      // handle silently
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (rule: ClassificationRule) => {
    try {
      await updateClassificationRule(rule.id, { active: !rule.active });
      refetch();
    } catch {
      // handle silently
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteClassificationRule(id);
      refetch();
    } catch {
      // handle silently
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Rule Form */}
      <div className="card card-body">
        <h4 className="mb-3 text-sm font-semibold text-gray-900">Add Classification Rule</h4>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-700">Pattern</label>
            <input
              className="input"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="e.g., superbuzz*"
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-700">Match Type</label>
            <select
              className="input"
              value={newMatchType}
              onChange={(e) =>
                setNewMatchType(e.target.value as ClassificationRule['match_type'])
              }
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
              <option value="regex">Regex</option>
            </select>
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-700">Classification</label>
            <select
              className="input"
              value={newClassification}
              onChange={(e) =>
                setNewClassification(e.target.value as ClassificationRule['classification'])
              }
            >
              <option value="brand">Brand</option>
              <option value="nonbrand">Non-brand</option>
              <option value="competitor">Competitor</option>
            </select>
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-gray-700">Priority</label>
            <input
              type="number"
              className="input"
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value))}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !newPattern.trim()}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      {/* Rules Table */}
      {loading ? (
        <LoadingState variant="skeleton" count={3} />
      ) : rules && rules.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Pattern
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Match
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Classification
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Priority
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap px-6 py-3 text-sm font-mono text-gray-900">
                    {rule.pattern}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    <span className="badge bg-gray-100 text-gray-600">{rule.match_type}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    <span
                      className={clsx(
                        'badge',
                        rule.classification === 'brand' && 'bg-brand-50 text-brand-700',
                        rule.classification === 'nonbrand' && 'bg-accent-50 text-accent-700',
                        rule.classification === 'competitor' && 'bg-warning-50 text-warning-700'
                      )}
                    >
                      {rule.classification}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                    {rule.priority}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={clsx(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        rule.active ? 'bg-accent-500' : 'bg-gray-300'
                      )}
                    >
                      <span
                        className={clsx(
                          'inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm',
                          rule.active ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-50 hover:text-danger-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No classification rules"
          description="Add rules to automatically classify search terms."
          icon={<FileText className="h-8 w-8" />}
        />
      )}
    </div>
  );
}

function CoverageTab() {
  const { data: coverage, loading } = useApi(() => fetchSearchTermCoverage());

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingState variant="cards" count={4} />
      ) : coverage ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card card-body">
              <p className="text-sm font-medium text-gray-500">Total Terms</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {formatNumber(coverage.total_terms)}
              </p>
            </div>
            <div className="card card-body">
              <p className="text-sm font-medium text-gray-500">Coverage</p>
              <p className="mt-1 text-2xl font-bold text-accent-600">
                {formatPercent(coverage.coverage_pct)}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all"
                  style={{ width: `${Math.min(coverage.coverage_pct, 100)}%` }}
                />
              </div>
            </div>
            <div className="card card-body">
              <p className="text-sm font-medium text-gray-500">Classified</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {formatNumber(coverage.classified_terms)}
              </p>
            </div>
            <div className="card card-body">
              <p className="text-sm font-medium text-gray-500">Unclassified</p>
              <p className="mt-1 text-2xl font-bold text-warning-600">
                {formatNumber(coverage.unclassified_terms)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="card card-body text-center">
              <p className="text-sm font-medium text-gray-500">Brand Terms</p>
              <p className="mt-1 text-xl font-bold text-brand-600">
                {formatNumber(coverage.brand_terms)}
              </p>
            </div>
            <div className="card card-body text-center">
              <p className="text-sm font-medium text-gray-500">Non-brand Terms</p>
              <p className="mt-1 text-xl font-bold text-accent-600">
                {formatNumber(coverage.nonbrand_terms)}
              </p>
            </div>
            <div className="card card-body text-center">
              <p className="text-sm font-medium text-gray-500">Competitor Terms</p>
              <p className="mt-1 text-xl font-bold text-warning-600">
                {formatNumber(coverage.competitor_terms)}
              </p>
            </div>
          </div>

          {/* Uncertain Terms */}
          {coverage.uncertain_terms.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-900">
                  Uncertain Terms ({coverage.uncertain_terms.length})
                </h4>
                <p className="mt-0.5 text-xs text-gray-500">
                  These terms need manual review for classification
                </p>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Term
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Suggested
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Confidence
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {coverage.uncertain_terms.slice(0, 20).map((ut, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-900">
                        {ut.term}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm">
                        <span
                          className={clsx(
                            'badge',
                            ut.suggested === 'brand' && 'bg-brand-50 text-brand-700',
                            ut.suggested === 'nonbrand' && 'bg-accent-50 text-accent-700',
                            ut.suggested === 'competitor' && 'bg-warning-50 text-warning-700'
                          )}
                        >
                          {ut.suggested}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                        {formatPercent(ut.confidence * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="No coverage data"
          description="Upload search term data to see classification coverage."
          icon={<BarChart3 className="h-8 w-8" />}
        />
      )}
    </div>
  );
}
