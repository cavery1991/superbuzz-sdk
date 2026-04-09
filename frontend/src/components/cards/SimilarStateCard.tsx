import React from 'react';
import { Calendar, Thermometer, Tag, TrendingUp } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/utils/format';
import type { SimilarState } from '@/types';

interface SimilarStateCardProps {
  state: SimilarState;
}

const SimilarStateCard: React.FC<SimilarStateCardProps> = ({ state }) => {
  const similarityPct = Math.round(state.similarity_score * 100);

  return (
    <div className="card card-body hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-900">
            {new Date(state.date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 rounded-full bg-gray-200"
            style={{ width: '60px' }}
          >
            <div
              className="h-2 rounded-full bg-brand-500"
              style={{ width: `${similarityPct}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-brand-600">{similarityPct}%</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <span className="badge bg-gray-100 text-gray-600">
          {state.day_of_week}
        </span>
        <span className="badge bg-gray-100 text-gray-600">
          {state.month}
        </span>
        <span className="badge bg-gray-100 text-gray-600 flex items-center gap-1">
          <Thermometer className="w-3 h-3" />
          {state.temperature}°F
        </span>
        <span className="badge bg-gray-100 text-gray-600">
          {state.spend_level}
        </span>
        {state.promo_active && (
          <span className="badge bg-warning-100 text-warning-700 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            Promo
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(state.revenue)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">ROAS</p>
          <p className="text-sm font-semibold text-gray-900">{state.roas.toFixed(2)}x</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">CVR</p>
          <p className="text-sm font-semibold text-gray-900">{formatPercent(state.cvr)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">New Customers</p>
          <p className="text-sm font-semibold text-gray-900">{state.new_customers}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">CPA</p>
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(state.cpa)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Marginal Return
          </p>
          <p className="text-sm font-semibold text-gray-900">{state.marginal_return.toFixed(2)}x</p>
        </div>
      </div>
    </div>
  );
};

export default SimilarStateCard;
