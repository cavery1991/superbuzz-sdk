import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronUp, CheckCircle, X } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import type { Insight } from '@/types';

interface InsightCardProps {
  insight: Insight;
  onDismiss?: (id: string) => void;
}

export default function InsightCard({ insight, onDismiss }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="card-body">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 mt-0.5">
              <Lightbulb className="h-5 w-5 text-brand-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-900">{insight.title}</h4>
                <ConfidenceBadge level={insight.confidence} />
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{insight.body}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onDismiss && (
              <button
                onClick={() => onDismiss(insight.id)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 ml-12 space-y-4 border-t border-gray-100 pt-4">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Interpretation
              </p>
              <p className="text-sm text-gray-700">{insight.interpretation}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recommended Action
              </p>
              <div className="flex items-start gap-2">
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-600" />
                <p className="text-sm text-gray-700">{insight.recommended_action}</p>
              </div>
            </div>
            {insight.evidence.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Evidence
                </p>
                <ul className="space-y-1.5">
                  {insight.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-500">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
