import { Calendar } from 'lucide-react';
import clsx from 'clsx';
import type { PresetRange } from '@/hooks/useApi';

interface DateRangePickerProps {
  preset: PresetRange;
  onPresetChange: (preset: PresetRange) => void;
}

const presets: { value: PresetRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

export default function DateRangePicker({ preset, onPresetChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
      <Calendar className="ml-2 h-4 w-4 text-gray-400" />
      {presets.map((p) => (
        <button
          key={p.value}
          onClick={() => onPresetChange(p.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
            preset === p.value
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
