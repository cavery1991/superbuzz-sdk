// ===== KPI & Overview Types =====
export interface KpiSummary {
  total_spend: number;
  total_revenue: number;
  blended_roas: number;
  mer: number;
  new_customer_pct: number;
  cpa: number;
  spend_wow_change: number;
  revenue_wow_change: number;
  roas_wow_change: number;
  mer_wow_change: number;
  new_customer_pct_wow_change: number;
  cpa_wow_change: number;
}

export interface BrandVsNonbrand {
  brand_spend: number;
  nonbrand_spend: number;
  brand_revenue: number;
  nonbrand_revenue: number;
  brand_roas: number;
  nonbrand_roas: number;
  brand_cpa: number;
  nonbrand_cpa: number;
  brand_cvr: number;
  nonbrand_cvr: number;
  brand_new_customer_pct: number;
  nonbrand_new_customer_pct: number;
  brand_marginal_roas: number;
  nonbrand_marginal_roas: number;
  brand_spend_pct: number;
  nonbrand_spend_pct: number;
  brand_revenue_pct: number;
  nonbrand_revenue_pct: number;
}

export interface DailyMetric {
  date: string;
  revenue: number;
  spend: number;
  roas: number;
  brand_spend: number;
  nonbrand_spend: number;
  brand_revenue: number;
  nonbrand_revenue: number;
  new_customers: number;
  cpa: number;
  organic_traffic: number;
  paid_brand_traffic: number;
}

// ===== Insight & Recommendation Types =====
export interface Insight {
  id: string;
  title: string;
  body: string;
  interpretation: string;
  confidence: 'high' | 'medium' | 'low';
  recommended_action: string;
  evidence: string[];
  category: string;
  priority: number;
  created_at: string;
}

export interface Recommendation {
  id: string;
  action: string;
  rationale: string;
  expected_effect: string;
  confidence: 'high' | 'medium' | 'low';
  risk: string;
  evidence: string[];
  status: 'pending' | 'accepted' | 'rejected';
  category: string;
  created_at: string;
  outcome?: string;
}

// ===== Incrementality Types =====
export interface IncrementalityObservational {
  brand_spend: number;
  nonbrand_spend: number;
  brand_revenue: number;
  nonbrand_revenue: number;
  brand_cpa: number;
  nonbrand_cpa: number;
  brand_mer: number;
  nonbrand_mer: number;
  brand_contribution_pct: number;
  nonbrand_contribution_pct: number;
  brand_new_customer_pct: number;
  nonbrand_new_customer_pct: number;
  brand_dependence_score: number;
  trend: DailyMetric[];
}

export interface IncrementalityProxy {
  cannibalization_estimate: number;
  paid_vs_organic_correlation: number;
  brand_marginal_roas: number;
  nonbrand_marginal_roas: number;
  spend_response_curve: Array<{ spend: number; revenue: number }>;
  diminishing_returns_threshold: number;
  organic_overlap_pct: number;
  paid_brand_vs_organic: Array<{
    date: string;
    paid_brand: number;
    organic_brand: number;
  }>;
}

export interface Experiment {
  id: string;
  name: string;
  type: 'geo_holdout' | 'time_holdout' | 'budget_shift';
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  treatment_description: string;
  control_description: string;
  start_date: string;
  end_date: string;
  configuration: Record<string, unknown>;
  results?: ExperimentResult;
  created_at: string;
}

export interface ExperimentResult {
  lift_pct: number;
  confidence_interval: [number, number];
  p_value: number;
  is_significant: boolean;
  treatment_metric: number;
  control_metric: number;
  treatment_data: Array<{ date: string; value: number }>;
  control_data: Array<{ date: string; value: number }>;
}

// ===== Causation Types =====
export interface CorrelationEntry {
  var1: string;
  var2: string;
  correlation: number;
}

export interface CausalAnalysis {
  variable_pair: [string, string];
  correlation: number;
  temporal_precedence: { result: string; score: number; detail: string };
  isolation_score: { result: string; score: number; detail: string };
  saturation_analysis: { result: string; score: number; detail: string };
  demand_dependency: { result: string; score: number; detail: string };
  overall_confidence: 'high' | 'medium' | 'low';
  verdict: 'likely_causal' | 'correlated_not_causal' | 'weak_confounded';
  explanation: string;
  evidence: string[];
  scatter_data: Array<{ x: number; y: number }>;
}

// ===== Pattern Memory Types =====
export interface ContextQuery {
  day_of_week?: string;
  month?: string;
  temperature_range?: string;
  spend_level?: string;
  promo_status?: string;
  brand_split?: string;
}

export interface SimilarState {
  date: string;
  similarity_score: number;
  day_of_week: string;
  month: string;
  temperature: number;
  spend_level: string;
  promo_active: boolean;
  brand_split_pct: number;
  revenue: number;
  roas: number;
  cvr: number;
  new_customers: number;
  marginal_return: number;
  cpa: number;
}

export interface PatternInsight {
  text: string;
  confidence: 'high' | 'medium' | 'low';
}

// ===== Simulator Types =====
export interface SimulationInput {
  brand_spend_change_pct: number;
  nonbrand_spend_change_pct: number;
  promo_active: boolean;
  temperature?: number;
  day_of_week?: string;
}

export interface SimulationResult {
  projected_revenue: number;
  projected_revenue_low: number;
  projected_revenue_high: number;
  projected_roas: number;
  projected_mer: number;
  new_customers_change: number;
  risk_assessment: string;
  risk_level: 'low' | 'medium' | 'high';
  historical_analogues: SimilarState[];
  warnings: string[];
  assumptions: string[];
}

// ===== Admin Types =====
export interface BrandKeyword {
  id: string;
  keyword: string;
  match_type: 'exact' | 'phrase' | 'broad';
  classification: 'brand' | 'nonbrand' | 'competitor';
}

export interface ClassificationRule {
  id: string;
  pattern: string;
  match_type: 'contains' | 'exact' | 'regex';
  classification: 'brand' | 'nonbrand' | 'competitor';
  priority: number;
  active: boolean;
}

export interface ContextualDataEntry {
  id: string;
  date: string;
  temperature: number;
  weather: string;
  promo_active: boolean;
  promo_description: string;
  holiday: string;
  notes: string;
}

export interface SearchTermCoverage {
  total_terms: number;
  classified_terms: number;
  unclassified_terms: number;
  coverage_pct: number;
  brand_terms: number;
  nonbrand_terms: number;
  competitor_terms: number;
  uncertain_terms: Array<{ term: string; suggested: string; confidence: number }>;
}

export interface DateRange {
  start: string;
  end: string;
}
