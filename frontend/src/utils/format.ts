export function formatCurrency(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

export function formatRoas(value: number): string {
  return `${value.toFixed(2)}x`;
}

export function formatConfidence(confidence: 'high' | 'medium' | 'low'): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

export function getConfidenceColor(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return 'text-confidence-high';
    case 'medium':
      return 'text-confidence-medium';
    case 'low':
      return 'text-confidence-low';
  }
}

export function getConfidenceBgColor(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return 'bg-accent-50 text-accent-700 border-accent-200';
    case 'medium':
      return 'bg-warning-50 text-warning-700 border-warning-200';
    case 'low':
      return 'bg-danger-50 text-danger-700 border-danger-200';
  }
}

export function getTrendColor(value: number): string {
  if (value > 0) return 'text-accent-600';
  if (value < 0) return 'text-danger-600';
  return 'text-gray-500';
}

export function getTrendArrow(value: number): string {
  if (value > 0) return '\u2191';
  if (value < 0) return '\u2193';
  return '\u2192';
}
