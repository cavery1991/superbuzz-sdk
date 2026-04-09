import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartDataItem = Record<string, any>;

interface ResponseCurveChartProps {
  data: ChartDataItem[];
  xKey: string;
  yKey: string;
  threshold?: number;
  height?: number;
}

const ResponseCurveChart: React.FC<ResponseCurveChartProps> = ({
  data,
  xKey,
  yKey,
  threshold,
  height = 300,
}) => {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
          label={{ value: xKey, position: 'insideBottom', offset: -5, fontSize: 11, fill: '#6B7280' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          label={{ value: yKey, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6B7280' }}
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
        {threshold !== undefined && (
          <ReferenceLine
            x={threshold}
            stroke="#EF4444"
            strokeDasharray="5 5"
            label={{
              value: 'Diminishing Returns',
              position: 'top',
              fontSize: 11,
              fill: '#EF4444',
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey={yKey}
          stroke="#3399FF"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: '#3399FF' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default ResponseCurveChart;
