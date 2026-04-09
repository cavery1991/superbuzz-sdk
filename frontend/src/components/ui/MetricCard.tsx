import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  prefix?: string;
  suffix?: string;
  sparklineData?: number[];
  sparklineColor?: string;
}

export default function MetricCard({
  label,
  value,
  change,
  changeLabel = 'vs last period',
  prefix,
  suffix,
  sparklineData,
  sparklineColor = '#3399FF',
}: MetricCardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change === undefined || change === 0;

  const chartData = sparklineData?.map((v, i) => ({ i, v }));

  return (
    <div className="card card-body hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {prefix}
            {value}
            {suffix}
          </p>
          {change !== undefined && (
            <div className="mt-2 flex items-center gap-1">
              {isPositive && <TrendingUp className="h-4 w-4 text-accent-600" />}
              {isNegative && <TrendingDown className="h-4 w-4 text-danger-600" />}
              {isNeutral && <Minus className="h-4 w-4 text-gray-400" />}
              <span
                className={clsx(
                  'text-sm font-medium',
                  isPositive && 'text-accent-600',
                  isNegative && 'text-danger-600',
                  isNeutral && 'text-gray-400'
                )}
              >
                {isPositive ? '+' : ''}
                {change.toFixed(1)}%
              </span>
              <span className="ml-1 text-xs text-gray-400">{changeLabel}</span>
            </div>
          )}
        </div>
        {chartData && chartData.length > 1 && (
          <div className="h-12 w-24 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={sparklineColor}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
