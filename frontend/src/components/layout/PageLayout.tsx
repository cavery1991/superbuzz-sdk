import Header from '@/components/layout/Header';
import type { PresetRange } from '@/hooks/useApi';

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  showDateRange?: boolean;
  preset?: PresetRange;
  onPresetChange?: (preset: PresetRange) => void;
  children: React.ReactNode;
}

export default function PageLayout({
  title,
  subtitle,
  showDateRange,
  preset,
  onPresetChange,
  children,
}: PageLayoutProps) {
  return (
    <div className="flex flex-col gap-6">
      <Header
        title={title}
        subtitle={subtitle}
        showDateRange={showDateRange}
        preset={preset}
        onPresetChange={onPresetChange}
      />
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
