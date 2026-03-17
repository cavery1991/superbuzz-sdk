// ── Metric calculation utilities ──

export interface PerformanceMetrics {
  ctr: number;
  cpc: number;
  conversionRate: number;
  cpa: number;
  roas: number;
  impressionShare?: number;
}

export function calcMetrics(data: {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
}): PerformanceMetrics {
  return {
    ctr: data.impressions > 0 ? data.clicks / data.impressions : 0,
    cpc: data.clicks > 0 ? data.cost / data.clicks : 0,
    conversionRate: data.clicks > 0 ? data.conversions / data.clicks : 0,
    cpa: data.conversions > 0 ? data.cost / data.conversions : Infinity,
    roas: data.cost > 0 ? data.conversionValue / data.cost : 0,
  };
}

export function aggregateMetrics(
  records: Array<{
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    conversionValue: number;
  }>
): { impressions: number; clicks: number; cost: number; conversions: number; conversionValue: number } {
  return records.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      cost: acc.cost + r.cost,
      conversions: acc.conversions + r.conversions,
      conversionValue: acc.conversionValue + r.conversionValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 }
  );
}
