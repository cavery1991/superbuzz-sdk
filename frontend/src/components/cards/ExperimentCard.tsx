import React from 'react';
import { FlaskConical, Clock, CheckCircle2, XCircle, FileEdit } from 'lucide-react';
import clsx from 'clsx';
import ConfidenceBadge from '@/components/ui/ConfidenceBadge';
import { formatPercent, formatDate } from '@/utils/format';
import type { Experiment } from '@/types';

interface ExperimentCardProps {
  experiment: Experiment;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  draft: {
    icon: <FileEdit className="w-4 h-4" />,
    label: 'Draft',
    color: 'bg-gray-100 text-gray-600',
  },
  running: {
    icon: <Clock className="w-4 h-4" />,
    label: 'Running',
    color: 'bg-blue-100 text-blue-700',
  },
  completed: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-700',
  },
  cancelled: {
    icon: <XCircle className="w-4 h-4" />,
    label: 'Cancelled',
    color: 'bg-red-100 text-red-700',
  },
};

const typeLabels: Record<string, string> = {
  geo_holdout: 'Geo Holdout',
  time_holdout: 'Time Holdout',
  budget_shift: 'Budget Shift',
};

const ExperimentCard: React.FC<ExperimentCardProps> = ({ experiment }) => {
  const status = statusConfig[experiment.status];

  return (
    <div className="card card-body hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900">{experiment.name}</h4>
            <p className="text-xs text-gray-500">{typeLabels[experiment.type] || experiment.type}</p>
          </div>
        </div>
        <span className={clsx('badge flex items-center gap-1', status.color)}>
          {status.icon}
          {status.label}
        </span>
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-start gap-2">
          <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Treatment:</span>
          <span className="text-xs text-gray-700">{experiment.treatment_description}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">Control:</span>
          <span className="text-xs text-gray-700">{experiment.control_description}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        <span>{formatDate(experiment.start_date)} - {formatDate(experiment.end_date)}</span>
      </div>

      {experiment.results && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-gray-500">Lift</p>
              <p className={clsx(
                'text-sm font-bold',
                experiment.results.lift_pct > 0 ? 'text-emerald-600' : 'text-red-600'
              )}>
                {experiment.results.lift_pct > 0 ? '+' : ''}
                {formatPercent(experiment.results.lift_pct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">CI</p>
              <p className="text-xs font-medium text-gray-700">
                [{formatPercent(experiment.results.confidence_interval[0])},{' '}
                {formatPercent(experiment.results.confidence_interval[1])}]
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Significant?</p>
              {experiment.results.is_significant ? (
                <ConfidenceBadge level="high" />
              ) : (
                <ConfidenceBadge level="low" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExperimentCard;
