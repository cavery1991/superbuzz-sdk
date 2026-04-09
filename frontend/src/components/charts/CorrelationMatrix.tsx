import React from 'react';
import type { CorrelationEntry } from '@/types';

interface CorrelationMatrixProps {
  data: CorrelationEntry[];
  variables: string[];
}

function getColor(value: number): string {
  if (value >= 0.7) return 'bg-emerald-500 text-white';
  if (value >= 0.4) return 'bg-emerald-300 text-emerald-900';
  if (value >= 0.1) return 'bg-emerald-100 text-emerald-800';
  if (value >= -0.1) return 'bg-gray-100 text-gray-600';
  if (value >= -0.4) return 'bg-red-100 text-red-800';
  if (value >= -0.7) return 'bg-red-300 text-red-900';
  return 'bg-red-500 text-white';
}

function getCorrelation(
  data: CorrelationEntry[],
  v1: string,
  v2: string
): number | null {
  if (v1 === v2) return 1;
  const entry = data.find(
    (d) =>
      (d.var1 === v1 && d.var2 === v2) || (d.var1 === v2 && d.var2 === v1)
  );
  return entry ? entry.correlation : null;
}

const CorrelationMatrix: React.FC<CorrelationMatrixProps> = ({ data, variables }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="p-2 text-xs font-medium text-gray-500 text-left"></th>
            {variables.map((v) => (
              <th
                key={v}
                className="p-2 text-xs font-medium text-gray-500 text-center whitespace-nowrap"
                style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxWidth: '40px' }}
              >
                {v.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variables.map((row) => (
            <tr key={row}>
              <td className="p-2 text-xs font-medium text-gray-700 whitespace-nowrap">
                {row.replace(/_/g, ' ')}
              </td>
              {variables.map((col) => {
                const val = getCorrelation(data, row, col);
                return (
                  <td key={col} className="p-1">
                    <div
                      className={`w-10 h-10 flex items-center justify-center rounded text-xs font-semibold ${
                        val !== null ? getColor(val) : 'bg-gray-50 text-gray-300'
                      }`}
                    >
                      {val !== null ? val.toFixed(2) : '-'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default CorrelationMatrix;
