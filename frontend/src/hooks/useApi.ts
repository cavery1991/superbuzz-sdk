import { useState, useEffect, useCallback, useMemo } from 'react';
import { subDays, startOfYear, format } from 'date-fns';
import type { DateRange } from '@/types';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => {
    setTrigger((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, ...deps]);

  return { data, loading, error, refetch };
}

export type PresetRange = '7d' | '30d' | '90d' | 'ytd' | '1y' | 'all';

interface UseDateRangeResult {
  dateRange: DateRange;
  preset: PresetRange;
  setPreset: (p: PresetRange) => void;
  setCustomRange: (range: DateRange) => void;
}

function computeRange(preset: PresetRange): DateRange {
  const now = new Date();
  const end = format(now, 'yyyy-MM-dd');

  switch (preset) {
    case '7d':
      return { start: format(subDays(now, 7), 'yyyy-MM-dd'), end };
    case '30d':
      return { start: format(subDays(now, 30), 'yyyy-MM-dd'), end };
    case '90d':
      return { start: format(subDays(now, 90), 'yyyy-MM-dd'), end };
    case 'ytd':
      return { start: format(startOfYear(now), 'yyyy-MM-dd'), end };
    case '1y':
      return { start: format(subDays(now, 365), 'yyyy-MM-dd'), end };
    case 'all':
      return { start: '2020-01-01', end };
  }
}

export function useDateRange(defaultPreset: PresetRange = '30d'): UseDateRangeResult {
  const [preset, setPresetState] = useState<PresetRange>(defaultPreset);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  const dateRange = useMemo(() => {
    if (customRange) return customRange;
    return computeRange(preset);
  }, [preset, customRange]);

  const setPreset = useCallback((p: PresetRange) => {
    setPresetState(p);
    setCustomRange(null);
  }, []);

  return { dateRange, preset, setPreset, setCustomRange };
}
