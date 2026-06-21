import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateGenerator, LLMGenerator, createGenerator, Taxonomy } from '../src/index.js';

const taxonomy = Taxonomy.sample();
const args = {
  raw: { title: 'Parka', description: 'A warm jacket.', brand: 'NorthPeak' },
  product: { id: 'x', categoryId: 5598, attributes: { color: 'navy', material: 'nylon', size: 'm' } },
  taxonomy,
  derivedTags: ['warmth', 'rain protection'],
};

test('TemplateGenerator writes a brand-led, attribute-rich title within 150 chars', async () => {
  const g = new TemplateGenerator();
  const { title, description, provider } = await g.generate(args);
  assert.equal(provider, 'template');
  assert.ok(title.length <= 150);
  assert.match(title, /NorthPeak/);
  assert.match(title.toLowerCase(), /navy/);
  assert.match(description.toLowerCase(), /rain protection|warmth/);
});

test('LLMGenerator uses the API response when valid', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'NorthPeak Navy Down Parka', description: 'Cozy and waterproof.' }) } }] }),
  });
  const g = new LLMGenerator({ apiUrl: 'http://mock', apiKey: 'k', fetchImpl });
  const out = await g.generate(args);
  assert.equal(out.provider, 'llm');
  assert.equal(out.title, 'NorthPeak Navy Down Parka');
});

test('LLMGenerator falls back to template on API error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'err' });
  const g = new LLMGenerator({ apiUrl: 'http://mock', apiKey: 'k', fetchImpl });
  const out = await g.generate(args);
  assert.equal(out.provider, 'template'); // degraded gracefully
  assert.match(out.title, /NorthPeak/);
});

test('createGenerator defaults to template and falls back without a key', () => {
  assert.equal(createGenerator({}, {}).name, 'template');
  assert.equal(createGenerator({ provider: 'llm' }, {}).name, 'template'); // no key -> fallback
  assert.equal(createGenerator({ provider: 'llm', apiKey: 'k' }).name, 'llm');
});
