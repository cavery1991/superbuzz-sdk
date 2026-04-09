import type {
  KpiSummary,
  BrandVsNonbrand,
  DailyMetric,
  Insight,
  Recommendation,
  IncrementalityObservational,
  IncrementalityProxy,
  Experiment,
  CorrelationEntry,
  CausalAnalysis,
  SimilarState,
  PatternInsight,
  SimulationInput,
  SimulationResult,
  BrandKeyword,
  ClassificationRule,
  ContextualDataEntry,
  SearchTermCoverage,
  ContextQuery,
  DateRange,
} from '@/types';

const BASE_URL = '/api/v1';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchKpiSummary(dateRange?: DateRange): Promise<KpiSummary> {
  const params = dateRange ? `?start=${dateRange.start}&end=${dateRange.end}` : '';
  return apiFetch<KpiSummary>(`/metrics/kpi-summary${params}`);
}

export async function fetchBrandVsNonbrand(dateRange?: DateRange): Promise<BrandVsNonbrand> {
  const params = dateRange ? `?start=${dateRange.start}&end=${dateRange.end}` : '';
  return apiFetch<BrandVsNonbrand>(`/metrics/brand-vs-nonbrand${params}`);
}

export async function fetchDailyMetrics(dateRange?: DateRange): Promise<DailyMetric[]> {
  const params = dateRange ? `?start=${dateRange.start}&end=${dateRange.end}` : '';
  return apiFetch<DailyMetric[]>(`/metrics/daily${params}`);
}

export async function fetchInsights(): Promise<Insight[]> {
  return apiFetch<Insight[]>('/insights');
}

export async function fetchRecommendations(status?: string): Promise<Recommendation[]> {
  const params = status ? `?status=${status}` : '';
  return apiFetch<Recommendation[]>(`/recommendations${params}`);
}

export async function fetchIncrementalityObservational(): Promise<IncrementalityObservational> {
  return apiFetch<IncrementalityObservational>('/incrementality/observational');
}

export async function fetchIncrementalityProxy(): Promise<IncrementalityProxy> {
  return apiFetch<IncrementalityProxy>('/incrementality/proxy');
}

export async function fetchExperiments(): Promise<Experiment[]> {
  return apiFetch<Experiment[]>('/incrementality/experiments');
}

export async function createExperiment(experiment: Omit<Experiment, 'id' | 'created_at' | 'results'>): Promise<Experiment> {
  return apiFetch<Experiment>('/incrementality/experiments', {
    method: 'POST',
    body: JSON.stringify(experiment),
  });
}

export async function fetchCorrelations(): Promise<CorrelationEntry[]> {
  return apiFetch<CorrelationEntry[]>('/causation/correlations');
}

export async function fetchCausalAnalysis(var1: string, var2: string): Promise<CausalAnalysis> {
  return apiFetch<CausalAnalysis>(`/causation/analysis?var_x=${encodeURIComponent(var1)}&var_y=${encodeURIComponent(var2)}`);
}

export async function fetchSimilarPatterns(query: ContextQuery): Promise<SimilarState[]> {
  return apiFetch<SimilarState[]>('/patterns/similar', {
    method: 'POST',
    body: JSON.stringify(query),
  });
}

export async function runSimulation(input: SimulationInput): Promise<SimulationResult> {
  return apiFetch<SimulationResult>('/simulator/scenario', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchBrandKeywords(): Promise<BrandKeyword[]> {
  return apiFetch<BrandKeyword[]>('/admin/brand-keywords');
}

export async function addBrandKeyword(keyword: Omit<BrandKeyword, 'id'>): Promise<BrandKeyword> {
  return apiFetch<BrandKeyword>('/admin/brand-keywords', {
    method: 'POST',
    body: JSON.stringify(keyword),
  });
}

export async function deleteBrandKeyword(id: string): Promise<void> {
  await apiFetch<void>(`/admin/brand-keywords/${id}`, { method: 'DELETE' });
}

export async function fetchClassificationRules(): Promise<ClassificationRule[]> {
  return apiFetch<ClassificationRule[]>('/admin/classification-rules');
}

export async function addClassificationRule(rule: Omit<ClassificationRule, 'id'>): Promise<ClassificationRule> {
  return apiFetch<ClassificationRule>('/admin/classification-rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

export async function updateClassificationRule(id: string, rule: Partial<ClassificationRule>): Promise<ClassificationRule> {
  return apiFetch<ClassificationRule>(`/admin/classification-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(rule),
  });
}

export async function deleteClassificationRule(id: string): Promise<void> {
  await apiFetch<void>(`/admin/classification-rules/${id}`, { method: 'DELETE' });
}

export async function fetchSearchTermCoverage(): Promise<SearchTermCoverage> {
  return apiFetch<SearchTermCoverage>('/search-terms/coverage');
}

export async function fetchContextualData(): Promise<ContextualDataEntry[]> {
  return apiFetch<ContextualDataEntry[]>('/admin/contextual-data');
}

export async function addContextualData(entry: Omit<ContextualDataEntry, 'id'>): Promise<ContextualDataEntry> {
  return apiFetch<ContextualDataEntry>('/admin/contextual-data', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function updateRecommendationStatus(id: string, status: 'accepted' | 'rejected'): Promise<Recommendation> {
  return apiFetch<Recommendation>(`/recommendations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function generateRecommendations(): Promise<Recommendation[]> {
  return apiFetch<Recommendation[]>('/recommendations/generate', { method: 'POST' });
}

export async function generateInsights(): Promise<Insight[]> {
  return apiFetch<Insight[]>('/insights/generate', { method: 'POST' });
}

export async function dismissInsight(id: string): Promise<void> {
  await apiFetch<void>(`/insights/${id}/dismiss`, { method: 'PATCH' });
}

export interface SearchTermEntry {
  term: string;
  classification: 'brand' | 'nonbrand' | 'competitor' | 'unclassified';
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

export async function fetchSearchTerms(dateRange?: DateRange): Promise<SearchTermEntry[]> {
  const params = dateRange ? `?start=${dateRange.start}&end=${dateRange.end}` : '';
  return apiFetch<SearchTermEntry[]>(`/search-terms${params}`);
}

export interface Campaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'removed';
  channel: string;
  daily_budget: number;
  classification: 'brand' | 'nonbrand' | 'mixed';
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  return apiFetch<Campaign[]>('/campaigns');
}

export async function fetchPatternQuery(query: ContextQuery): Promise<{ similar_states: SimilarState[]; insights: PatternInsight[] }> {
  return apiFetch<{ similar_states: SimilarState[]; insights: PatternInsight[] }>('/patterns/query', {
    method: 'POST',
    body: JSON.stringify(query),
  });
}
