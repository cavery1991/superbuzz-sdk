import { useState, useEffect, useCallback } from 'react';
import {
  Target,
  RefreshCw,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import PageLayout from '@/components/layout/PageLayout';
import RecommendationCard from '@/components/ui/RecommendationCard';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import {
  fetchRecommendations,
  generateRecommendations,
  updateRecommendationStatus,
} from '@/services/api';
import { formatDate } from '@/utils/format';
import type { Recommendation } from '@/types';

// ──────────────────────────────── Demo data ────────────────────────────────

const DEMO_RECOMMENDATIONS: Recommendation[] = [
  {
    id: '1',
    action: 'Reduce brand spend by 15% and reallocate to non-brand',
    rationale: 'Brand marginal ROAS (1.2x) is well below non-brand (3.9x). Proxy incrementality analysis suggests 65% cannibalization.',
    expected_effect: 'Estimated $3.2K additional revenue per week with same total spend.',
    confidence: 'high',
    risk: 'Short-term brand impression share may decrease. Monitor organic brand traffic for 2 weeks.',
    evidence: ['Brand mROAS: 1.2x vs NB mROAS: 3.9x', 'Cannibalization est: 65%', '3 similar reallocations showed +8% revenue'],
    status: 'pending',
    category: 'budget',
    created_at: '2026-04-09',
  },
  {
    id: '2',
    action: 'Refresh non-brand ad creatives',
    rationale: 'Non-brand CTR has declined 8% WoW and CVR is trending down, suggesting creative fatigue.',
    expected_effect: 'Historical creative refreshes improved CVR by 5-12% within first 2 weeks.',
    confidence: 'medium',
    risk: 'New creatives may underperform initially during learning period.',
    evidence: ['CTR down 8% WoW', 'CVR down 5% WoW', 'Last creative refresh was 45 days ago'],
    status: 'pending',
    category: 'creative',
    created_at: '2026-04-09',
  },
  {
    id: '3',
    action: 'Launch brand holdout experiment in 2 markets',
    rationale: 'Proxy analysis suggests high cannibalization but experimental validation is needed.',
    expected_effect: 'Definitive measurement of brand incrementality within 3-4 weeks.',
    confidence: 'high',
    risk: 'Temporary revenue dip in holdout markets (estimated 2-5%).',
    evidence: ['Brand dependence: 0.72', 'Proxy cannibalization: 65%', 'Experiment cost: ~$2K'],
    status: 'pending',
    category: 'measurement',
    created_at: '2026-04-09',
  },
  {
    id: '4',
    action: 'Increase non-brand budget by 10% for warm weather period',
    rationale: 'Pattern memory shows 17% avg revenue lift during warm April weeks. Current non-brand marginal ROAS supports scaling.',
    expected_effect: 'Estimated $1.5K additional revenue with 10% budget increase during warm spell.',
    confidence: 'medium',
    risk: 'Weather forecast may change. Review after 3 days.',
    evidence: ['8 similar warm-weather periods', 'Avg lift: 17.3%', 'NB mROAS: 3.9x supports scaling'],
    status: 'accepted',
    category: 'budget',
    created_at: '2026-04-07',
    outcome: 'Revenue increased 14% in first 3 days.',
  },
  {
    id: '5',
    action: 'Pause underperforming ad groups with ROAS below 1.5x',
    rationale: '3 ad groups have ROAS below 1.5x for 14+ days, consuming $1.2K/week.',
    expected_effect: 'Save $1.2K/week in wasted spend while improving blended ROAS.',
    confidence: 'high',
    risk: 'May lose some volume on long-tail keywords. Monitor search impression share.',
    evidence: ['3 ad groups below 1.5x ROAS', '$1.2K/week spend', '14-day consistent underperformance'],
    status: 'rejected',
    category: 'optimization',
    created_at: '2026-04-05',
  },
];

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected';

// ──────────────────────────────── Component ────────────────────────────────

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>(DEMO_RECOMMENDATIONS);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchRecommendations()
      .then((data) => {
        if (!cancelled && data.length > 0) setRecommendations(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const handleGenerate = useCallback(() => {
    setGenerating(true);
    generateRecommendations()
      .then((newRecs) => {
        setRecommendations((prev) => [...newRecs, ...prev]);
      })
      .catch(() => {})
      .finally(() => setGenerating(false));
  }, []);

  const handleAccept = useCallback((id: string) => {
    updateRecommendationStatus(id, 'accepted')
      .then((updated) => {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? updated : r))
        );
      })
      .catch(() => {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'accepted' } : r))
        );
      });
  }, []);

  const handleReject = useCallback((id: string) => {
    updateRecommendationStatus(id, 'rejected')
      .then((updated) => {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? updated : r))
        );
      })
      .catch(() => {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'rejected' } : r))
        );
      });
  }, []);

  const filtered = statusFilter === 'all'
    ? recommendations
    : recommendations.filter((r) => r.status === statusFilter);

  const pendingCount = recommendations.filter((r) => r.status === 'pending').length;
  const acceptedCount = recommendations.filter((r) => r.status === 'accepted').length;
  const rejectedCount = recommendations.filter((r) => r.status === 'rejected').length;

  const highConfPending = recommendations.filter(
    (r) => r.status === 'pending' && r.confidence === 'high'
  );

  if (loading) {
    return (
      <PageLayout title="Recommendations" subtitle="Data-driven actions for your PPC strategy">
        <LoadingState variant="skeleton" count={4} />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Recommendations" subtitle="Data-driven actions for your PPC strategy">
      {/* Action Summary */}
      {highConfPending.length > 0 && (
        <section className="card card-body border-l-4 border-l-accent-500">
          <div className="flex items-start gap-3">
            <Zap className="w-6 h-6 text-accent-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">What the Data Suggests You Should Do</h3>
              <ul className="space-y-1.5 mt-2">
                {highConfPending.map((rec) => (
                  <li key={rec.id} className="flex items-start gap-2 text-sm text-gray-700">
                    <Target className="w-4 h-4 text-accent-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{rec.action}</strong> - {rec.expected_effect}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Status summary + filter + generate */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          {[
            { id: 'all' as StatusFilter, label: 'All', count: recommendations.length, icon: null },
            { id: 'pending' as StatusFilter, label: 'Pending', count: pendingCount, icon: <Clock className="w-3.5 h-3.5" /> },
            { id: 'accepted' as StatusFilter, label: 'Accepted', count: acceptedCount, icon: <CheckCircle className="w-3.5 h-3.5" /> },
            { id: 'rejected' as StatusFilter, label: 'Rejected', count: rejectedCount, icon: <XCircle className="w-3.5 h-3.5" /> },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                statusFilter === f.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              )}
            >
              {f.icon}
              {f.label}
              <span className={clsx(
                'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                statusFilter === f.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'
              )}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-primary flex items-center gap-2"
        >
          <RefreshCw className={clsx('w-4 h-4', generating && 'animate-spin')} />
          {generating ? 'Generating...' : 'Generate New'}
        </button>
      </section>

      {/* Active Recommendations */}
      <section>
        {filtered.length === 0 ? (
          <EmptyState
            title="No recommendations found"
            description={`No ${statusFilter === 'all' ? '' : statusFilter} recommendations available. Try generating new ones.`}
          />
        ) : (
          <div className="space-y-3">
            {filtered
              .sort((a, b) => {
                const confOrder = { high: 0, medium: 1, low: 2 };
                const statusOrder = { pending: 0, accepted: 1, rejected: 2 };
                const statusDiff = statusOrder[a.status] - statusOrder[b.status];
                if (statusDiff !== 0) return statusDiff;
                return confOrder[a.confidence] - confOrder[b.confidence];
              })
              .map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  onAccept={rec.status === 'pending' ? handleAccept : undefined}
                  onReject={rec.status === 'pending' ? handleReject : undefined}
                />
              ))}
          </div>
        )}
      </section>

      {/* Recommendation History Table */}
      <section className="card">
        <div className="card-body">
          <h3 className="text-base font-semibold text-gray-900 mb-0">Recommendation History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Confidence</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recommendations.map((rec) => (
                <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 text-gray-500 whitespace-nowrap">{formatDate(rec.created_at)}</td>
                  <td className="px-6 py-3 font-medium text-gray-900 max-w-xs truncate">{rec.action}</td>
                  <td className="px-6 py-3">
                    <span className="badge bg-gray-100 text-gray-600">{rec.category}</span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={clsx(
                      'badge',
                      rec.confidence === 'high' && 'bg-emerald-100 text-emerald-700',
                      rec.confidence === 'medium' && 'bg-amber-100 text-amber-700',
                      rec.confidence === 'low' && 'bg-red-100 text-red-700'
                    )}>
                      {rec.confidence}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={clsx(
                      'badge',
                      rec.status === 'pending' && 'bg-blue-100 text-blue-700',
                      rec.status === 'accepted' && 'bg-emerald-100 text-emerald-700',
                      rec.status === 'rejected' && 'bg-gray-100 text-gray-500'
                    )}>
                      {rec.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-600 max-w-xs truncate">
                    {rec.outcome || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageLayout>
  );
}
