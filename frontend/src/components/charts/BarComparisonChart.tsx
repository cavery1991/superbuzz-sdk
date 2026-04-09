import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface BarConfig {
  dataKey: string;
  name: string;
  color: string;
  stackId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartDataItem = Record<string, any>;

interface BarComparisonChartProps {
  data: ChartDataItem[];
  bars: BarConfig[];
  xKey: string;
  height?: number;
}

const BarComparisonChart: React.FC<BarComparisonChartProps> = ({
  data,
  bars,
  xKey,
  height = 300,
}) => {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            fontSize: '12px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color}
            stackId={bar.stackId}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

export default BarComparisonChart;
