import React, { useState } from 'react';
import { Target, ChevronDown, ChevronUp, AlertTriangle, Zap } from 'lucide-react';
import clsx from 'clsx';
import ConfidenceBadge from './ConfidenceBadge';
import type { Recommendation } from '@/types';

interface RecommendationCardProps {
  recommendation: Recommendation;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  onAccept,
  onReject,
}) => {
  const [expanded, setExpanded] = useState(false);

  const statusColors: Record<string, string> = {
    pending: 'bg-blue-50 text-blue-700 border-blue-200',
    accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-gray-100 text-gray-500 border-gray-200',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Target className="w-5 h-5 text-accent-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h4 className="text-sm font-semibold text-gray-900">{recommendation.action}</h4>
              <ConfidenceBadge level={recommendation.confidence} />
              <span
                className={clsx(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                  statusColors[recommendation.status]
                )}
              >
                {recommendation.status.charAt(0).toUpperCase() + recommendation.status.slice(1)}
              </span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{recommendation.rationale}</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 hover:text-gray-600 mt-1 flex-shrink-0"
        >
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 ml-12 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expected Effect</p>
            <div className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-brand-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-700">{recommendation.expected_effect}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Risk</p>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-700">{recommendation.risk}</p>
            </div>
          </div>
          {recommendation.evidence.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Evidence</p>
              <ul className="space-y-1">
                {recommendation.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recommendation.status === 'pending' && (onAccept || onReject) && (
            <div className="flex gap-2 pt-2">
              {onAccept && (
                <button
                  onClick={() => onAccept(recommendation.id)}
                  className="btn-success btn-sm"
                >
                  Accept
                </button>
              )}
              {onReject && (
                <button
                  onClick={() => onReject(recommendation.id)}
                  className="btn-secondary btn-sm"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecommendationCard;
