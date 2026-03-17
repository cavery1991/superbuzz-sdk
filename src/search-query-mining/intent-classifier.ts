import { IntentCategory, SearchTermRecord } from '../shared/types';
import { tokenize } from '../shared/tokenizer';

export interface IntentClassifierConfig {
  brandTerms?: string[];
  competitorTerms?: string[];
  transactionalSignals?: string[];
  informationalSignals?: string[];
  navigationalSignals?: string[];
}

const DEFAULT_TRANSACTIONAL = [
  'buy', 'purchase', 'order', 'shop', 'deal', 'discount', 'coupon', 'sale',
  'price', 'cheap', 'best', 'top', 'review', 'compare', 'vs', 'affordable',
  'free shipping', 'near me', 'online', 'subscribe', 'get', 'hire',
];

const DEFAULT_INFORMATIONAL = [
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'guide', 'tutorial',
  'tips', 'ideas', 'examples', 'definition', 'meaning', 'difference',
  'can', 'does', 'is', 'are', 'should',
];

const DEFAULT_NAVIGATIONAL = [
  'login', 'log in', 'sign in', 'signup', 'sign up', 'account', 'dashboard',
  'support', 'contact', 'help', 'download', 'app',
];

export class IntentClassifier {
  private brandTerms: Set<string>;
  private competitorTerms: Set<string>;
  private transactionalSignals: string[];
  private informationalSignals: string[];
  private navigationalSignals: string[];

  constructor(config: IntentClassifierConfig = {}) {
    this.brandTerms = new Set((config.brandTerms ?? []).map(t => t.toLowerCase()));
    this.competitorTerms = new Set((config.competitorTerms ?? []).map(t => t.toLowerCase()));
    this.transactionalSignals = config.transactionalSignals ?? DEFAULT_TRANSACTIONAL;
    this.informationalSignals = config.informationalSignals ?? DEFAULT_INFORMATIONAL;
    this.navigationalSignals = config.navigationalSignals ?? DEFAULT_NAVIGATIONAL;
  }

  classify(searchTerm: string): IntentCategory {
    const lower = searchTerm.toLowerCase();
    const tokens = tokenize(lower);

    // Brand / competitor detection
    for (const brand of this.brandTerms) {
      if (lower.includes(brand)) return 'brand';
    }
    for (const comp of this.competitorTerms) {
      if (lower.includes(comp)) return 'competitor';
    }

    // Navigational
    if (this.navigationalSignals.some(s => this.matchesSignal(lower, tokens, s))) {
      return 'navigational';
    }

    // Informational (question words at start are strong signals)
    const firstToken = tokens[0];
    if (firstToken && this.informationalSignals.includes(firstToken)) {
      return 'informational';
    }

    // Transactional
    if (this.transactionalSignals.some(s => this.matchesSignal(lower, tokens, s))) {
      return 'high-intent-transactional';
    }

    // Long-tail heuristic: 4+ words with no strong signal
    if (tokens.length >= 4) {
      return 'long-tail';
    }

    return 'generic';
  }

  private matchesSignal(lower: string, tokens: string[], signal: string): boolean {
    // Multi-word signals use substring matching
    if (signal.includes(' ')) return lower.includes(signal);
    // Single-word signals use token matching (word boundary)
    return tokens.includes(signal);
  }

  classifyBatch(records: SearchTermRecord[]): Map<IntentCategory, SearchTermRecord[]> {
    const groups = new Map<IntentCategory, SearchTermRecord[]>();
    for (const record of records) {
      const intent = this.classify(record.searchTerm);
      if (!groups.has(intent)) groups.set(intent, []);
      groups.get(intent)!.push(record);
    }
    return groups;
  }
}
