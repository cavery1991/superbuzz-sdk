import clsx from 'clsx';
import { formatConfidence, getConfidenceBgColor } from '@/utils/format';

interface ConfidenceBadgeProps {
  level: 'high' | 'medium' | 'low';
  size?: 'sm' | 'md';
}

export default function ConfidenceBadge({ level, size = 'sm' }: ConfidenceBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border font-semibold',
        getConfidenceBgColor(level),
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      )}
    >
      <span
        className={clsx(
          'mr-1.5 inline-block rounded-full',
          size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
          level === 'high' && 'bg-accent-500',
          level === 'medium' && 'bg-warning-500',
          level === 'low' && 'bg-danger-500'
        )}
      />
      {formatConfidence(level)} Confidence
    </span>
  );
}
