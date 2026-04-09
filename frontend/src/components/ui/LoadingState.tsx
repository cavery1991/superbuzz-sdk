import clsx from 'clsx';

interface LoadingStateProps {
  variant?: 'spinner' | 'skeleton' | 'cards';
  count?: number;
}

function SkeletonLine({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse rounded-md bg-gray-200', className)} />
  );
}

function SkeletonCard() {
  return (
    <div className="card card-body space-y-3">
      <SkeletonLine className="h-4 w-1/3" />
      <SkeletonLine className="h-8 w-1/2" />
      <SkeletonLine className="h-3 w-1/4" />
    </div>
  );
}

export default function LoadingState({ variant = 'spinner', count = 4 }: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div className="space-y-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card card-body space-y-3">
            <SkeletonLine className="h-4 w-2/5" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative">
        <div className="h-12 w-12 rounded-full border-4 border-gray-200" />
        <div className="absolute left-0 top-0 h-12 w-12 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
      <p className="mt-4 text-sm font-medium text-gray-500">Loading data...</p>
    </div>
  );
}
