import DateRangePicker from '@/components/ui/DateRangePicker';
import type { PresetRange } from '@/hooks/useApi';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showDateRange?: boolean;
  preset?: PresetRange;
  onPresetChange?: (preset: PresetRange) => void;
}

export default function Header({
  title,
  subtitle,
  showDateRange = false,
  preset,
  onPresetChange,
}: HeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        )}
      </div>
      {showDateRange && preset && onPresetChange && (
        <DateRangePicker preset={preset} onPresetChange={onPresetChange} />
      )}
    </div>
  );
}
