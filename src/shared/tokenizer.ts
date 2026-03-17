// ── Text tokenization and n-gram utilities for query clustering ──

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(' '));
  }
  return result;
}

export function allNgrams(text: string, maxN: number = 3): string[] {
  const tokens = tokenize(text);
  const result: string[] = [];
  for (let n = 1; n <= Math.min(maxN, tokens.length); n++) {
    result.push(...ngrams(tokens, n));
  }
  return result;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}
