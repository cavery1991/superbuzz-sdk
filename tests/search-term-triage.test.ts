import { TriageEngine, LandingPageAnalyzer, FeedTitleMatcher } from '../src/search-term-triage';
import { SearchTermRecord } from '../src/shared/types';

function makeRecord(overrides: Partial<SearchTermRecord> & { searchTerm: string }): SearchTermRecord {
  return {
    impressions: 1000,
    clicks: 50,
    cost: 100,
    conversions: 5,
    conversionValue: 500,
    ...overrides,
  };
}

describe('TriageEngine', () => {
  const engine = new TriageEngine({
    targetRoas: 3.0,
    minClicks: 10,
    minSpendForNegative: 20,
    isolationRoasThreshold: 5.0,
    isolationMinConversions: 3,
  });

  it('flags zero-conversion terms as negatives', () => {
    const records = [
      makeRecord({ searchTerm: 'free stuff', clicks: 20, cost: 50, conversions: 0, conversionValue: 0 }),
    ];
    const report = engine.triage(records);
    const negatives = report.actionQueue.filter(a => a.action === 'add_negative');
    expect(negatives.length).toBe(1);
    expect(negatives[0].searchTerm).toBe('free stuff');
  });

  it('flags very low ROAS terms as negatives', () => {
    const records = [
      makeRecord({ searchTerm: 'bad term', clicks: 30, cost: 100, conversions: 1, conversionValue: 20 }),
    ];
    const report = engine.triage(records);
    const negatives = report.actionQueue.filter(a => a.action === 'add_negative');
    expect(negatives.length).toBe(1);
  });

  it('recommends isolation for high-performing terms', () => {
    const records = [
      makeRecord({ searchTerm: 'great term', clicks: 40, cost: 50, conversions: 5, conversionValue: 500 }),
    ];
    const report = engine.triage(records);
    const isolations = report.actionQueue.filter(a => a.action.startsWith('isolate'));
    expect(isolations.length).toBe(1);
    expect(isolations[0].priority).toBe('high');
  });

  it('leaves acceptable terms in broad/pmax', () => {
    const records = [
      makeRecord({ searchTerm: 'decent term', clicks: 30, cost: 80, conversions: 4, conversionValue: 200, matchType: 'broad' }),
    ];
    const report = engine.triage(records);
    const leaves = report.actionQueue.filter(a => a.action === 'leave_in_broad');
    expect(leaves.length).toBe(1);
  });

  it('identifies PMax terms correctly', () => {
    const records = [
      makeRecord({ searchTerm: 'pmax term', clicks: 30, cost: 80, conversions: 4, conversionValue: 200, matchType: 'auto' }),
    ];
    const report = engine.triage(records);
    const pmax = report.actionQueue.filter(a => a.action === 'leave_in_pmax');
    expect(pmax.length).toBe(1);
  });

  it('skips terms with insufficient data', () => {
    const records = [
      makeRecord({ searchTerm: 'low data', clicks: 3, cost: 5, conversions: 0, conversionValue: 0 }),
    ];
    const report = engine.triage(records);
    // Should have no triage actions (only possibly feed/LP actions)
    const triageActions = report.actionQueue.filter(
      a => !['push_feed_title_update', 'create_landing_page_gap_note'].includes(a.action)
    );
    expect(triageActions.length).toBe(0);
  });

  it('produces a complete summary', () => {
    const records = [
      makeRecord({ searchTerm: 'negative me', clicks: 20, cost: 60, conversions: 0, conversionValue: 0 }),
      makeRecord({ searchTerm: 'isolate me', clicks: 40, cost: 50, conversions: 5, conversionValue: 500 }),
      makeRecord({ searchTerm: 'leave me', clicks: 30, cost: 80, conversions: 4, conversionValue: 200, matchType: 'broad' }),
    ];
    const report = engine.triage(records);
    expect(report.summary.totalTermsAnalyzed).toBe(3);
    expect(report.summary.addNegative).toBeGreaterThan(0);
    expect(report.summary.estimatedCostSavings).toBeGreaterThan(0);
  });

  it('sorts core triage actions by priority', () => {
    const records = [
      makeRecord({ searchTerm: 'low priority', clicks: 30, cost: 80, conversions: 4, conversionValue: 200, matchType: 'broad' }),
      makeRecord({ searchTerm: 'high priority', clicks: 40, cost: 50, conversions: 5, conversionValue: 500 }),
      makeRecord({ searchTerm: 'medium priority', clicks: 20, cost: 60, conversions: 0, conversionValue: 0 }),
    ];
    const report = engine.triage(records);
    // Filter to only core triage actions (exclude feed/LP actions appended later)
    const coreActions = report.actionQueue.filter(
      a => !['push_feed_title_update', 'create_landing_page_gap_note'].includes(a.action)
    );
    const priorities = coreActions.map(a => a.priority);
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < priorities.length; i++) {
      expect(priorityOrder[priorities[i]]).toBeGreaterThanOrEqual(priorityOrder[priorities[i - 1]]);
    }
  });
});

describe('LandingPageAnalyzer', () => {
  const analyzer = new LandingPageAnalyzer();

  it('detects missing landing pages', () => {
    const records = [
      makeRecord({ searchTerm: 'no lp term', clicks: 10 }),
    ];
    const gaps = analyzer.analyze(records);
    expect(gaps.length).toBe(1);
    expect(gaps[0].issue).toBe('no_landing_page');
  });

  it('detects low-relevance landing pages', () => {
    const records = [
      makeRecord({ searchTerm: 'running shoes men', clicks: 20, landingPage: 'https://example.com/categories/dresses' }),
    ];
    const gaps = analyzer.analyze(records);
    expect(gaps.length).toBe(1);
    expect(gaps[0].issue).toBe('low_relevance');
  });

  it('does not flag relevant landing pages', () => {
    const records = [
      makeRecord({ searchTerm: 'running shoes', clicks: 20, landingPage: 'https://example.com/shoes/running-shoes' }),
    ];
    const gaps = analyzer.analyze(records);
    expect(gaps.length).toBe(0);
  });
});

describe('FeedTitleMatcher', () => {
  const matcher = new FeedTitleMatcher({
    feedTitles: ['Blue Running Shoe Mens', 'Red Dress Women Summer'],
    minImpressions: 50,
    minConversions: 1,
  });

  it('finds terms with tokens missing from feed titles', () => {
    const records = [
      makeRecord({ searchTerm: 'waterproof running shoes', impressions: 100, conversions: 2 }),
    ];
    const updates = matcher.findUpdates(records);
    expect(updates.length).toBe(1);
    expect(updates[0].missingTokens).toContain('waterproof');
  });

  it('skips terms with low impressions', () => {
    const records = [
      makeRecord({ searchTerm: 'rare unique term', impressions: 10, conversions: 1 }),
    ];
    const updates = matcher.findUpdates(records);
    expect(updates.length).toBe(0);
  });

  it('skips terms with zero conversions', () => {
    const records = [
      makeRecord({ searchTerm: 'no converter', impressions: 200, conversions: 0 }),
    ];
    const updates = matcher.findUpdates(records);
    expect(updates.length).toBe(0);
  });
});
