import { SearchTermRecord } from '../shared/types';
import { tokenize, jaccardSimilarity } from '../shared/tokenizer';
import { aggregateMetrics, calcMetrics, PerformanceMetrics } from '../shared/metrics';

export interface QueryCluster {
  id: string;
  label: string;
  terms: SearchTermRecord[];
  aggregatedMetrics: PerformanceMetrics;
  totalCost: number;
  totalConversions: number;
  totalConversionValue: number;
  termCount: number;
}

export interface ClusterConfig {
  /** Jaccard similarity threshold for grouping (default: 0.3) */
  similarityThreshold?: number;
  /** Minimum cluster size to report (default: 2) */
  minClusterSize?: number;
}

export class QueryClusterer {
  private similarityThreshold: number;
  private minClusterSize: number;

  constructor(config: ClusterConfig = {}) {
    this.similarityThreshold = config.similarityThreshold ?? 0.3;
    this.minClusterSize = config.minClusterSize ?? 2;
  }

  cluster(records: SearchTermRecord[]): QueryCluster[] {
    const tokenSets = records.map(r => new Set(tokenize(r.searchTerm)));
    const assigned = new Set<number>();
    const clusters: QueryCluster[] = [];

    for (let i = 0; i < records.length; i++) {
      if (assigned.has(i)) continue;

      const clusterIndices = [i];
      assigned.add(i);

      for (let j = i + 1; j < records.length; j++) {
        if (assigned.has(j)) continue;
        if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= this.similarityThreshold) {
          clusterIndices.push(j);
          assigned.add(j);
        }
      }

      const clusterTerms = clusterIndices.map(idx => records[idx]);

      if (clusterTerms.length >= this.minClusterSize) {
        const agg = aggregateMetrics(clusterTerms);
        const metrics = calcMetrics(agg);

        // Label = most common shared tokens
        const label = this.deriveLabel(clusterTerms);

        clusters.push({
          id: `cluster-${clusters.length + 1}`,
          label,
          terms: clusterTerms,
          aggregatedMetrics: metrics,
          totalCost: agg.cost,
          totalConversions: agg.conversions,
          totalConversionValue: agg.conversionValue,
          termCount: clusterTerms.length,
        });
      }
    }

    // Sort by cost descending — biggest spend clusters first
    return clusters.sort((a, b) => b.totalCost - a.totalCost);
  }

  private deriveLabel(terms: SearchTermRecord[]): string {
    const freq = new Map<string, number>();
    for (const t of terms) {
      for (const token of tokenize(t.searchTerm)) {
        freq.set(token, (freq.get(token) ?? 0) + 1);
      }
    }
    // Tokens appearing in >50% of terms, sorted by frequency
    const threshold = terms.length * 0.5;
    const common = [...freq.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token)
      .slice(0, 3);

    return common.length > 0 ? common.join(' ') : terms[0].searchTerm;
  }
}
