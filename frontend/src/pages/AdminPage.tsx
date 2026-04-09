import { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Tag,
  FileText,
  Calendar,
  SlidersHorizontal,
  BarChart3,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import {
  fetchBrandKeywords,
  addBrandKeyword,
  deleteBrandKeyword,
  fetchClassificationRules,
  addClassificationRule,
  updateClassificationRule,
  deleteClassificationRule,
  fetchContextualData,
  addContextualData,
  fetchSearchTermCoverage,
} from '@/services/api';
import { formatDate, formatPercent, formatNumber } from '@/utils/format';
import type {
  BrandKeyword,
  ClassificationRule,
  ContextualDataEntry,
  SearchTermCoverage,
} from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_KEYWORDS: BrandKeyword[] = [
  { id: '1', keyword: 'superbuzz', match_type: 'broad', classification: 'brand' },
  { id: '2', keyword: 'super buzz', match_type: 'phrase', classification: 'brand' },
  { id: '3', keyword: 'superbuzz pre workout', match_type: 'exact', classification: 'brand' },
  { id: '4', keyword: 'super buzz energy', match_type: 'phrase', classification: 'brand' },
  { id: '5', keyword: 'competitor x', match_type: 'broad', classification: 'competitor' },
];

const DEMO_RULES: ClassificationRule[] = [
  { id: '1', pattern: 'superbuzz', match_type: 'contains', classification: 'brand', priority: 100, active: true },
  { id: '2', pattern: 'super buzz', match_type: 'contains', classification: 'brand', priority: 99, active: true },
  { id: '3', pattern: '^buy .+ online$', match_type: 'regex', classification: 'nonbrand', priority: 50, active: true },
  { id: '4', pattern: 'competitor x', match_type: 'contains', classification: 'competitor', priority: 80, active: true },
  { id: '5', pattern: 'competitor y', match_type: 'contains', classification: 'competitor', priority: 79, active: false },
];

const DEMO_CONTEXTUAL: ContextualDataEntry[] = [
  { id: '1', date: '2026-04-09', temperature: 78, weather: 'Sunny', promo_active: false, promo_description: '', holiday: '', notes: '' },
  { id: '2', date: '2026-04-08', temperature: 74, weather: 'Partly Cloudy', promo_active: false, promo_description: '', holiday: '', notes: '' },
  { id: '3', date: '2026-04-07', temperature: 71, weather: 'Sunny', promo_active: true, promo_description: 'Spring Sale 20% off', holiday: '', notes: 'Email blast sent' },
  { id: '4', date: '2026-04-06', temperature: 65, weather: 'Cloudy', promo_active: true, promo_description: 'Spring Sale 20% off', holiday: '', notes: '' },
  { id: '5', date: '2026-04-05', temperature: 62, weather: 'Rain', promo_active: false, promo_description: '', holiday: '', notes: '' },
];

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
    { term: 'buzz energy supplement', suggested: 'brand', confidence: 0.55 },
    { term: 'pre workout reviews 2026', suggested: 'nonbrand', confidence: 0.93 },
  ],
};

type AdminTab = 'keywords' | 'rules' | 'contextual' | 'weights' | 'coverage' | 'settings';

interface SimilarityWeights {
  day_of_week: number;
  month: number;
  temperature: number;
  spend_level: number;
  promo_status: number;
  brand_split: number;
}

interface SystemModule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

// ──────────────────────────────── Component ────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('keywords');
  const [loading, setLoading] = useState(true);

  // Brand Keywords state
  const [keywords, setKeywords] = useState<BrandKeyword[]>(DEMO_KEYWORDS);
  const [newKeyword, setNewKeyword] = useState({ keyword: '', match_type: 'broad' as BrandKeyword['match_type'], classification: 'brand' as BrandKeyword['classification'] });
  const [showKeywordForm, setShowKeywordForm] = useState(false);

  // Classification Rules state
  const [rules, setRules] = useState<ClassificationRule[]>(DEMO_RULES);
  const [newRule, setNewRule] = useState({ pattern: '', match_type: 'contains' as ClassificationRule['match_type'], classification: 'brand' as ClassificationRule['classification'], priority: 50, active: true });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Contextual Data state
  const [contextualData, setContextualData] = useState<ContextualDataEntry[]>(DEMO_CONTEXTUAL);
  const [newEntry, setNewEntry] = useState({ date: '', temperature: 72, weather: '', promo_active: false, promo_description: '', holiday: '', notes: '' });
  const [showEntryForm, setShowEntryForm] = useState(false);

  // Similarity Weights
  const [weights, setWeights] = useState<SimilarityWeights>({
    day_of_week: 0.15,
    month: 0.2,
    temperature: 0.15,
    spend_level: 0.2,
    promo_status: 0.15,
    brand_split: 0.15,
  });

  // Coverage
  const [coverage, setCoverage] = useState<SearchTermCoverage>(DEMO_COVERAGE);

  // System Settings
  const [modules, setModules] = useState<SystemModule[]>([
    { id: 'brand_analysis', name: 'Brand vs Non-brand Analysis', description: 'Automatically classify search terms and compute brand/non-brand splits.', enabled: true },
    { id: 'incrementality', name: 'Incrementality Estimation', description: 'Proxy incrementality modeling using organic overlap analysis.', enabled: true },
    { id: 'causation', name: 'Causation Analysis', description: 'Run causal checks on correlated variable pairs.', enabled: true },
    { id: 'pattern_memory', name: 'Pattern Memory', description: 'Match current conditions to historical patterns for context-aware decisions.', enabled: true },
    { id: 'recommendations', name: 'Auto-Recommendations', description: 'Generate automated recommendations based on analysis results.', enabled: true },
    { id: 'experiment_design', name: 'Experiment Design', description: 'AI-assisted experiment design suggestions.', enabled: false },
    { id: 'weather_integration', name: 'Weather Integration', description: 'Automatically fetch and incorporate weather data.', enabled: true },
    { id: 'competitor_monitoring', name: 'Competitor Monitoring', description: 'Track competitor brand keywords and auction insights.', enabled: false },
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      fetchBrandKeywords(),
      fetchClassificationRules(),
      fetchContextualData(),
      fetchSearchTermCoverage(),
    ]).then((results) => {
      if (cancelled) return;
      const [kwR, rulesR, ctxR, covR] = results;
      if (kwR.status === 'fulfilled' && kwR.value.length > 0) setKeywords(kwR.value);
      if (rulesR.status === 'fulfilled' && rulesR.value.length > 0) setRules(rulesR.value);
      if (ctxR.status === 'fulfilled' && ctxR.value.length > 0) setContextualData(ctxR.value);
      if (covR.status === 'fulfilled') setCoverage(covR.value);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  // ── Keyword handlers ──

  const handleAddKeyword = useCallback(() => {
    if (!newKeyword.keyword.trim()) return;
    addBrandKeyword(newKeyword)
      .then((kw) => setKeywords((prev) => [...prev, kw]))
      .catch(() => {
        const demo: BrandKeyword = { id: String(Date.now()), ...newKeyword };
        setKeywords((prev) => [...prev, demo]);
      });
    setNewKeyword({ keyword: '', match_type: 'broad', classification: 'brand' });
    setShowKeywordForm(false);
  }, [newKeyword]);

  const handleDeleteKeyword = useCallback((id: string) => {
    deleteBrandKeyword(id).catch(() => {});
    setKeywords((prev) => prev.filter((k) => k.id !== id));
  }, []);

  // ── Rule handlers ──

  const handleAddRule = useCallback(() => {
    if (!newRule.pattern.trim()) return;
    addClassificationRule(newRule)
      .then((r) => setRules((prev) => [...prev, r]))
      .catch(() => {
        const demo: ClassificationRule = { id: String(Date.now()), ...newRule };
        setRules((prev) => [...prev, demo]);
      });
    setNewRule({ pattern: '', match_type: 'contains', classification: 'brand', priority: 50, active: true });
    setShowRuleForm(false);
  }, [newRule]);

  const handleToggleRule = useCallback((id: string) => {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    const newActive = !rule.active;
    updateClassificationRule(id, { active: newActive }).catch(() => {});
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, active: newActive } : r));
  }, [rules]);

  const handleDeleteRule = useCallback((id: string) => {
    deleteClassificationRule(id).catch(() => {});
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // ── Contextual data handlers ──

  const handleAddEntry = useCallback(() => {
    if (!newEntry.date) return;
    addContextualData(newEntry)
      .then((entry) => setContextualData((prev) => [entry, ...prev]))
      .catch(() => {
        const demo: ContextualDataEntry = { id: String(Date.now()), ...newEntry };
        setContextualData((prev) => [demo, ...prev]);
      });
    setNewEntry({ date: '', temperature: 72, weather: '', promo_active: false, promo_description: '', holiday: '', notes: '' });
    setShowEntryForm(false);
  }, [newEntry]);

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'keywords', label: 'Brand Keywords', icon: <Tag className="w-4 h-4" /> },
    { id: 'rules', label: 'Classification Rules', icon: <FileText className="w-4 h-4" /> },
    { id: 'contextual', label: 'Contextual Data', icon: <Calendar className="w-4 h-4" /> },
    { id: 'weights', label: 'Similarity Weights', icon: <SlidersHorizontal className="w-4 h-4" /> },
    { id: 'coverage', label: 'Coverage', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'System Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <PageLayout title="Admin" subtitle="Manage system configuration and data">
        <LoadingState />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Admin" subtitle="Manage system configuration and data">
      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
              activeTab === tab.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Brand Keywords ── */}
      {activeTab === 'keywords' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Brand Keywords ({keywords.length})</h3>
            <button
              onClick={() => setShowKeywordForm(!showKeywordForm)}
              className="btn-primary btn-sm flex items-center gap-1"
            >
              {showKeywordForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showKeywordForm ? 'Cancel' : 'Add Keyword'}
            </button>
          </div>

          {showKeywordForm && (
            <div className="card card-body">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Keyword</label>
                  <input
                    type="text"
                    value={newKeyword.keyword}
                    onChange={(e) => setNewKeyword({ ...newKeyword, keyword: e.target.value })}
                    placeholder="Enter keyword..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Match Type</label>
                  <select
                    value={newKeyword.match_type}
                    onChange={(e) => setNewKeyword({ ...newKeyword, match_type: e.target.value as BrandKeyword['match_type'] })}
                    className="input"
                  >
                    <option value="exact">Exact</option>
                    <option value="phrase">Phrase</option>
                    <option value="broad">Broad</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Classification</label>
                  <div className="flex gap-2">
                    <select
                      value={newKeyword.classification}
                      onChange={(e) => setNewKeyword({ ...newKeyword, classification: e.target.value as BrandKeyword['classification'] })}
                      className="input flex-1"
                    >
                      <option value="brand">Brand</option>
                      <option value="nonbrand">Non-brand</option>
                      <option value="competitor">Competitor</option>
                    </select>
                    <button onClick={handleAddKeyword} className="btn-success btn-sm">
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Match Type</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Classification</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {keywords.map((kw) => (
                    <tr key={kw.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">{kw.keyword}</td>
                      <td className="px-6 py-3">
                        <span className="badge bg-gray-100 text-gray-600">{kw.match_type}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className={clsx(
                          'badge',
                          kw.classification === 'brand' && 'bg-blue-100 text-blue-700',
                          kw.classification === 'nonbrand' && 'bg-emerald-100 text-emerald-700',
                          kw.classification === 'competitor' && 'bg-amber-100 text-amber-700'
                        )}>
                          {kw.classification}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => handleDeleteKeyword(kw.id)}
                          className="text-gray-400 hover:text-red-600 transition-colors p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {keywords.length === 0 && (
              <EmptyState
                title="No keywords configured"
                description="Add brand keywords to improve search term classification."
              />
            )}
          </div>
        </section>
      )}

      {/* ── Classification Rules ── */}
      {activeTab === 'rules' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Classification Rules ({rules.length})</h3>
            <button
              onClick={() => setShowRuleForm(!showRuleForm)}
              className="btn-primary btn-sm flex items-center gap-1"
            >
              {showRuleForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showRuleForm ? 'Cancel' : 'Add Rule'}
            </button>
          </div>

          {showRuleForm && (
            <div className="card card-body">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Pattern</label>
                  <input
                    type="text"
                    value={newRule.pattern}
                    onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                    placeholder="e.g., superbuzz or ^buy .+ online$"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Match Type</label>
                  <select
                    value={newRule.match_type}
                    onChange={(e) => setNewRule({ ...newRule, match_type: e.target.value as ClassificationRule['match_type'] })}
                    className="input"
                  >
                    <option value="contains">Contains</option>
                    <option value="exact">Exact</option>
                    <option value="regex">Regex</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Classification</label>
                  <select
                    value={newRule.classification}
                    onChange={(e) => setNewRule({ ...newRule, classification: e.target.value as ClassificationRule['classification'] })}
                    className="input"
                  >
                    <option value="brand">Brand</option>
                    <option value="nonbrand">Non-brand</option>
                    <option value="competitor">Competitor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newRule.priority}
                      onChange={(e) => setNewRule({ ...newRule, priority: Number(e.target.value) })}
                      className="input flex-1"
                      min={1}
                      max={100}
                    />
                    <button onClick={handleAddRule} className="btn-success btn-sm">
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Pattern</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Match Type</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Classification</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rules
                    .sort((a, b) => b.priority - a.priority)
                    .map((rule) => (
                      <tr key={rule.id} className={clsx('transition-colors', rule.active ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60')}>
                        <td className="px-6 py-3 font-mono text-sm text-gray-900">{rule.pattern}</td>
                        <td className="px-6 py-3">
                          <span className="badge bg-gray-100 text-gray-600">{rule.match_type}</span>
                        </td>
                        <td className="px-6 py-3">
                          <span className={clsx(
                            'badge',
                            rule.classification === 'brand' && 'bg-blue-100 text-blue-700',
                            rule.classification === 'nonbrand' && 'bg-emerald-100 text-emerald-700',
                            rule.classification === 'competitor' && 'bg-amber-100 text-amber-700'
                          )}>
                            {rule.classification}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center font-medium text-gray-700">{rule.priority}</td>
                        <td className="px-6 py-3 text-center">
                          <button
                            onClick={() => handleToggleRule(rule.id)}
                            className="text-gray-400 hover:text-brand-600 transition-colors"
                          >
                            {rule.active ? (
                              <ToggleRight className="w-6 h-6 text-brand-600" />
                            ) : (
                              <ToggleLeft className="w-6 h-6 text-gray-400" />
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingRuleId(editingRuleId === rule.id ? null : rule.id)}
                              className="text-gray-400 hover:text-brand-600 transition-colors p-1"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="text-gray-400 hover:text-red-600 transition-colors p-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {rules.length === 0 && (
              <EmptyState
                title="No classification rules"
                description="Add rules to automatically classify search terms."
              />
            )}
          </div>
        </section>
      )}

      {/* ── Contextual Data ── */}
      {activeTab === 'contextual' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Contextual Data ({contextualData.length} entries)</h3>
            <button
              onClick={() => setShowEntryForm(!showEntryForm)}
              className="btn-primary btn-sm flex items-center gap-1"
            >
              {showEntryForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showEntryForm ? 'Cancel' : 'Add Entry'}
            </button>
          </div>

          {showEntryForm && (
            <div className="card card-body">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={newEntry.date}
                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Temperature (°F)</label>
                  <input
                    type="number"
                    value={newEntry.temperature}
                    onChange={(e) => setNewEntry({ ...newEntry, temperature: Number(e.target.value) })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Weather</label>
                  <input
                    type="text"
                    value={newEntry.weather}
                    onChange={(e) => setNewEntry({ ...newEntry, weather: e.target.value })}
                    placeholder="Sunny, Cloudy, Rain..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEntry.promo_active}
                      onChange={(e) => setNewEntry({ ...newEntry, promo_active: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Promo Active
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Promo Description</label>
                  <input
                    type="text"
                    value={newEntry.promo_description}
                    onChange={(e) => setNewEntry({ ...newEntry, promo_description: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Holiday</label>
                  <input
                    type="text"
                    value={newEntry.holiday}
                    onChange={(e) => setNewEntry({ ...newEntry, holiday: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newEntry.notes}
                    onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                    className="input flex-1"
                  />
                  <button onClick={handleAddEntry} className="btn-success btn-sm flex items-center gap-1">
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Temp</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Weather</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Promo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Promo Desc</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Holiday</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contextualData.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{entry.temperature}°F</td>
                      <td className="px-4 py-3 text-gray-700">{entry.weather || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        {entry.promo_active ? (
                          <span className="badge bg-emerald-100 text-emerald-700">Active</span>
                        ) : (
                          <span className="badge bg-gray-100 text-gray-500">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[150px] truncate">{entry.promo_description || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{entry.holiday || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">{entry.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Similarity Weights ── */}
      {activeTab === 'weights' && (
        <section className="space-y-4">
          <div className="card card-body">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Similarity Matching Weights</h3>
            <p className="text-sm text-gray-500 mb-6">
              Adjust how much each contextual factor influences historical pattern matching. Weights should sum to 1.0.
            </p>

            <div className="space-y-5">
              {Object.entries(weights).map(([key, value]) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700">
                      {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </label>
                    <span className="text-sm font-bold text-brand-600">{value.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={value * 100}
                    onChange={(e) => {
                      const newVal = Number(e.target.value) / 100;
                      setWeights((prev) => ({ ...prev, [key]: newVal }));
                    }}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-brand-600"
                  />
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 rounded-lg bg-gray-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Total Weight</span>
                <span className={clsx(
                  'text-sm font-bold',
                  Math.abs(Object.values(weights).reduce((s, v) => s + v, 0) - 1) < 0.05 ? 'text-emerald-600' : 'text-red-600'
                )}>
                  {Object.values(weights).reduce((s, v) => s + v, 0).toFixed(2)}
                </span>
              </div>
              {Math.abs(Object.values(weights).reduce((s, v) => s + v, 0) - 1) >= 0.05 && (
                <p className="text-xs text-red-600 mt-1">Weights should sum to approximately 1.0</p>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button className="btn-primary">Save Weights</button>
            </div>
          </div>
        </section>
      )}

      {/* ── Classification Coverage ── */}
      {activeTab === 'coverage' && (
        <section className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Total Terms</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(coverage.total_terms)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Coverage</p>
              <p className="text-xl font-bold text-emerald-600">{formatPercent(coverage.coverage_pct, 0)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Classified</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(coverage.classified_terms)}</p>
            </div>
            <div className="card card-body text-center">
              <p className="text-xs text-gray-500">Unclassified</p>
              <p className="text-xl font-bold text-red-600">{formatNumber(coverage.unclassified_terms)}</p>
            </div>
          </div>

          {/* Coverage bar */}
          <div className="card card-body">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Classification Distribution</h3>
            <div className="flex h-8 rounded-lg overflow-hidden">
              <div
                className="bg-blue-500 flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${(coverage.brand_terms / coverage.total_terms) * 100}%` }}
              >
                {coverage.brand_terms > 100 ? 'Brand' : ''}
              </div>
              <div
                className="bg-emerald-500 flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${(coverage.nonbrand_terms / coverage.total_terms) * 100}%` }}
              >
                {coverage.nonbrand_terms > 100 ? 'Non-brand' : ''}
              </div>
              <div
                className="bg-amber-500 flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${(coverage.competitor_terms / coverage.total_terms) * 100}%` }}
              >
                {coverage.competitor_terms > 100 ? 'Comp' : ''}
              </div>
              <div
                className="bg-red-200 flex items-center justify-center text-red-700 text-xs font-semibold"
                style={{ width: `${(coverage.unclassified_terms / coverage.total_terms) * 100}%` }}
              >
                {coverage.unclassified_terms > 100 ? 'Unclassified' : ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-gray-600">Brand: {formatNumber(coverage.brand_terms)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500" />
                <span className="text-gray-600">Non-brand: {formatNumber(coverage.nonbrand_terms)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-500" />
                <span className="text-gray-600">Competitor: {formatNumber(coverage.competitor_terms)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-200" />
                <span className="text-gray-600">Unclassified: {formatNumber(coverage.unclassified_terms)}</span>
              </div>
            </div>
          </div>

          {/* Uncertain terms */}
          {coverage.uncertain_terms.length > 0 && (
            <div className="card">
              <div className="card-body">
                <div className="flex items-center gap-2 mb-0">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <h3 className="text-base font-semibold text-gray-900">Terms Needing Review ({coverage.uncertain_terms.length})</h3>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-b border-gray-200 bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Search Term</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Suggested</th>
                      <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Confidence</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {coverage.uncertain_terms.map((term) => (
                      <tr key={term.term} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900">{term.term}</td>
                        <td className="px-6 py-3">
                          <span className={clsx(
                            'badge',
                            term.suggested === 'brand' && 'bg-blue-100 text-blue-700',
                            term.suggested === 'nonbrand' && 'bg-emerald-100 text-emerald-700',
                            term.suggested === 'competitor' && 'bg-amber-100 text-amber-700'
                          )}>
                            {term.suggested}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-2 rounded-full bg-gray-200">
                              <div
                                className={clsx(
                                  'h-2 rounded-full',
                                  term.confidence > 0.8 ? 'bg-emerald-500' : term.confidence > 0.6 ? 'bg-amber-500' : 'bg-red-500'
                                )}
                                style={{ width: `${term.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{formatPercent(term.confidence * 100, 0)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button className="btn-success btn-sm flex items-center gap-1" title="Accept suggestion">
                              <Check className="w-3.5 h-3.5" />
                              Accept
                            </button>
                            <button className="btn-secondary btn-sm" title="Review manually">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── System Settings ── */}
      {activeTab === 'settings' && (
        <section className="space-y-4">
          <div className="card card-body">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Recommendation Logic Modules</h3>
            <p className="text-sm text-gray-500 mb-6">
              Enable or disable specific analysis and recommendation modules.
            </p>

            <div className="divide-y divide-gray-100">
              {modules.map((mod) => (
                <div key={mod.id} className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{mod.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{mod.description}</p>
                  </div>
                  <button
                    onClick={() => {
                      setModules((prev) =>
                        prev.map((m) => m.id === mod.id ? { ...m, enabled: !m.enabled } : m)
                      );
                    }}
                    className="flex-shrink-0 ml-4"
                  >
                    {mod.enabled ? (
                      <ToggleRight className="w-10 h-6 text-brand-600" />
                    ) : (
                      <ToggleLeft className="w-10 h-6 text-gray-400" />
                    )}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button className="btn-primary">Save Settings</button>
            </div>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
