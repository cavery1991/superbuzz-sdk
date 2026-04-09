import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface LineConfig {
  dataKey: string;
  name: string;
  color: string;
  yAxisId?: string;
  strokeDasharray?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartDataItem = Record<string, any>;

interface TimeSeriesChartProps {
  data: ChartDataItem[];
  lines: LineConfig[];
  xKey: string;
  height?: number;
  showLegend?: boolean;
  formatY?: (value: number) => string;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  lines,
  xKey,
  height = 300,
  showLegend = true,
  formatY,
}) => {
  const hasSecondAxis = lines.some((l) => l.yAxisId === 'right');

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatY}
        />
        {hasSecondAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatY}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            fontSize: '12px',
          }}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
          />
        )}
        {lines.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color}
            yAxisId={line.yAxisId || 'left'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            strokeDasharray={line.strokeDasharray}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default TimeSeriesChart;
