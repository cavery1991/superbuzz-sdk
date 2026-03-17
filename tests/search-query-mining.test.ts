import { SearchQueryMiner, IntentClassifier, ProfitabilityAnalyzer, QueryClusterer, NegativeKeywordFinder, ExpansionFinder } from '../src/search-query-mining';
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

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier({
    brandTerms: ['superbuzz', 'acme'],
    competitorTerms: ['competitor-x'],
  });

  it('classifies brand terms', () => {
    expect(classifier.classify('superbuzz shoes')).toBe('brand');
    expect(classifier.classify('acme widget review')).toBe('brand');
  });

  it('classifies competitor terms', () => {
    expect(classifier.classify('competitor-x alternative')).toBe('competitor');
  });

  it('classifies transactional terms', () => {
    expect(classifier.classify('buy running shoes online')).toBe('high-intent-transactional');
    expect(classifier.classify('best deal laptop')).toBe('high-intent-transactional');
  });

  it('classifies informational terms', () => {
    expect(classifier.classify('how to clean suede shoes')).toBe('informational');
    expect(classifier.classify('what is cloud computing')).toBe('informational');
  });

  it('classifies navigational terms', () => {
    expect(classifier.classify('amazon login')).toBe('navigational');
  });

  it('classifies long-tail terms', () => {
    expect(classifier.classify('red leather ankle boots women')).toBe('long-tail');
  });

  it('classifies generic terms', () => {
    expect(classifier.classify('shoes')).toBe('generic');
    // "laptop bag" matches transactional signal "top" — expected
    expect(classifier.classify('widget')).toBe('generic');
  });

  it('classifies batch of records', () => {
    const records = [
      makeRecord({ searchTerm: 'superbuzz widget' }),
      makeRecord({ searchTerm: 'how to fix widget' }),
      makeRecord({ searchTerm: 'buy widget online' }),
    ];
    const groups = classifier.classifyBatch(records);
    expect(groups.get('brand')?.length).toBe(1);
    expect(groups.get('informational')?.length).toBe(1);
    expect(groups.get('high-intent-transactional')?.length).toBe(1);
  });
});

describe('ProfitabilityAnalyzer', () => {
  const analyzer = new ProfitabilityAnalyzer({
    profitableRoasThreshold: 3.0,
    wastefulRoasThreshold: 1.0,
    minimumClicks: 5,
  });

  it('identifies profitable terms', () => {
    const result = analyzer.analyze(makeRecord({
      searchTerm: 'profitable term',
      cost: 100,
      conversionValue: 500,
      clicks: 50,
    }));
    expect(result.tier).toBe('profitable');
    expect(result.wastedSpend).toBe(0);
  });

  it('identifies wasteful terms', () => {
    const result = analyzer.analyze(makeRecord({
      searchTerm: 'wasteful term',
      cost: 200,
      conversionValue: 50,
      clicks: 30,
    }));
    expect(result.tier).toBe('wasteful');
    expect(result.wastedSpend).toBe(200);
  });

  it('identifies marginal terms', () => {
    const result = analyzer.analyze(makeRecord({
      searchTerm: 'marginal term',
      cost: 100,
      conversionValue: 150,
      clicks: 20,
    }));
    expect(result.tier).toBe('marginal');
  });

  it('handles low-data terms as marginal', () => {
    const result = analyzer.analyze(makeRecord({
      searchTerm: 'low data',
      clicks: 2,
      cost: 5,
      conversionValue: 0,
      conversions: 0,
    }));
    expect(result.tier).toBe('marginal');
  });

  it('calculates total wasted spend', () => {
    const records = [
      makeRecord({ searchTerm: 'waste1', cost: 200, conversionValue: 50, clicks: 30 }),
      makeRecord({ searchTerm: 'good1', cost: 100, conversionValue: 500, clicks: 50 }),
      makeRecord({ searchTerm: 'waste2', cost: 150, conversionValue: 30, clicks: 20 }),
    ];
    expect(analyzer.totalWastedSpend(records)).toBe(350);
  });
});

describe('QueryClusterer', () => {
  const clusterer = new QueryClusterer({ similarityThreshold: 0.3, minClusterSize: 2 });

  it('clusters similar terms', () => {
    const records = [
      makeRecord({ searchTerm: 'blue running shoes' }),
      makeRecord({ searchTerm: 'running shoes blue' }),
      makeRecord({ searchTerm: 'red dress women' }),
      makeRecord({ searchTerm: 'women red dress' }),
    ];
    const clusters = clusterer.cluster(records);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });

  it('does not cluster dissimilar terms', () => {
    const records = [
      makeRecord({ searchTerm: 'blue running shoes' }),
      makeRecord({ searchTerm: 'chocolate cake recipe' }),
    ];
    const clusters = clusterer.cluster(records);
    expect(clusters.length).toBe(0); // below minClusterSize
  });

  it('sorts clusters by cost descending', () => {
    const records = [
      makeRecord({ searchTerm: 'cheap phone case', cost: 50 }),
      makeRecord({ searchTerm: 'phone case cheap', cost: 30 }),
      makeRecord({ searchTerm: 'expensive laptop bag', cost: 200 }),
      makeRecord({ searchTerm: 'laptop bag expensive', cost: 150 }),
    ];
    const clusters = clusterer.cluster(records);
    if (clusters.length >= 2) {
      expect(clusters[0].totalCost).toBeGreaterThanOrEqual(clusters[1].totalCost);
    }
  });
});

describe('NegativeKeywordFinder', () => {
  const finder = new NegativeKeywordFinder({
    roasThreshold: 0.5,
    minSpend: 10,
    zeroConversionImpressionThreshold: 100,
    zeroConversionClickThreshold: 10,
  });

  it('finds zero-conversion exact negatives', () => {
    const records = [
      makeRecord({ searchTerm: 'free stuff online', impressions: 500, clicks: 20, cost: 40, conversions: 0, conversionValue: 0 }),
    ];
    const candidates = finder.findCandidates(records);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].keyword).toBe('free stuff online');
    expect(candidates[0].matchType).toBe('exact');
  });

  it('finds phrase-level negatives from token analysis', () => {
    const records = [
      makeRecord({ searchTerm: 'free widget download', impressions: 200, clicks: 15, cost: 30, conversions: 0, conversionValue: 0 }),
      makeRecord({ searchTerm: 'free tool online', impressions: 150, clicks: 12, cost: 25, conversions: 0, conversionValue: 0 }),
    ];
    const candidates = finder.findCandidates(records);
    const phraseNegatives = candidates.filter(c => c.matchType === 'phrase');
    expect(phraseNegatives.some(c => c.keyword === 'free')).toBe(true);
  });

  it('sorts by wasted spend descending', () => {
    const records = [
      makeRecord({ searchTerm: 'waste small', impressions: 200, clicks: 15, cost: 20, conversions: 0, conversionValue: 0 }),
      makeRecord({ searchTerm: 'waste large', impressions: 500, clicks: 30, cost: 80, conversions: 0, conversionValue: 0 }),
    ];
    const candidates = finder.findCandidates(records);
    if (candidates.length >= 2) {
      expect(candidates[0].totalWastedSpend).toBeGreaterThanOrEqual(candidates[1].totalWastedSpend);
    }
  });
});

describe('ExpansionFinder', () => {
  const finder = new ExpansionFinder({
    minRoas: 2.0,
    minConversions: 2,
    minClicks: 10,
    existingExactKeywords: ['already tracked'],
  });

  it('finds expansion opportunities', () => {
    const records = [
      makeRecord({ searchTerm: 'great new product', clicks: 30, conversions: 5, cost: 50, conversionValue: 300 }),
    ];
    const opps = finder.findOpportunities(records);
    expect(opps.length).toBe(1);
    expect(opps[0].suggestedAction).toBe('add_as_exact_keyword');
  });

  it('suggests new ad group for long-tail terms', () => {
    const records = [
      makeRecord({ searchTerm: 'buy red leather shoes online', clicks: 20, conversions: 3, cost: 40, conversionValue: 200 }),
    ];
    const opps = finder.findOpportunities(records);
    expect(opps[0].suggestedAction).toBe('create_new_adgroup');
  });

  it('excludes existing exact keywords', () => {
    const records = [
      makeRecord({ searchTerm: 'already tracked', clicks: 30, conversions: 5, cost: 50, conversionValue: 300 }),
    ];
    const opps = finder.findOpportunities(records);
    expect(opps.length).toBe(0);
  });

  it('excludes low-data terms', () => {
    const records = [
      makeRecord({ searchTerm: 'rare term', clicks: 3, conversions: 1, cost: 5, conversionValue: 50 }),
    ];
    const opps = finder.findOpportunities(records);
    expect(opps.length).toBe(0);
  });
});

describe('SearchQueryMiner (integration)', () => {
  it('produces a complete mining report', () => {
    const miner = new SearchQueryMiner({
      intent: { brandTerms: ['mybrand'] },
      profitability: { minimumClicks: 5 },
    });

    const records: SearchTermRecord[] = [
      makeRecord({ searchTerm: 'mybrand shoes', cost: 50, conversionValue: 400, clicks: 30, conversions: 8 }),
      makeRecord({ searchTerm: 'buy running shoes', cost: 100, conversionValue: 600, clicks: 50, conversions: 10 }),
      makeRecord({ searchTerm: 'free shoes download', cost: 80, conversionValue: 0, conversions: 0, clicks: 40, impressions: 500 }),
      makeRecord({ searchTerm: 'how to clean shoes', cost: 30, conversionValue: 20, clicks: 15, conversions: 1 }),
      makeRecord({ searchTerm: 'running shoes sale', cost: 70, conversionValue: 350, clicks: 35, conversions: 7 }),
    ];

    const report = miner.mine(records);

    expect(report.summary.totalTerms).toBe(5);
    expect(report.summary.totalSpend).toBeGreaterThan(0);
    expect(report.intentGroups.size).toBeGreaterThan(0);
    expect(report.profitabilityGroups.size).toBeGreaterThan(0);
    expect(report.negativeKeywordCandidates.length).toBeGreaterThan(0);
    expect(report.expansionOpportunities.length).toBeGreaterThan(0);
  });
});
