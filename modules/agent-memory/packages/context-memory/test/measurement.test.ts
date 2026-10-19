import { expect, it } from 'vitest';
import {
  MemoryMeter,
  MemoryMutations,
  readMemoryContext,
  resolveMemoryConfig,
} from '@ta-agent/context-memory';
import { TestMemoryStore } from './support/store.js';
import { testCounter } from './support/counter.js';

it('uses full rendered counts rather than adding cached item counts', async () => {
  const store = new TestMemoryStore();
  const meter = new MemoryMeter({
    counter: testCounter('nonadditive', (text) => Promise.resolve(text.includes('|') ? 100 : 1)),
  });
  const mutations = new MemoryMutations({
    store,
    meter,
    defaults: { measurementRef: 'nonadditive' },
  });
  await expect(
    mutations.create({
      memoryId: 'a',
      requestId: 'create',
      config: { render: { format: 'text', separator: '|' }, maxContextTokens: 10 },
      items: [{ content: 'a' }, { content: 'b' }],
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(store.commits).toBe(0);
});
it('renders JSON with real identities and counts even an empty JSON document', async () => {
  const meter = new MemoryMeter({ counter: testCounter('characters') });
  const config = resolveMemoryConfig({ measurementRef: 'characters', render: { format: 'json' } });
  const result = await meter.measure([{ id: 'real-id', content: '"\n' }], config);
  expect(result.text).toBe(JSON.stringify([{ id: 'real-id', content: '"\n' }]));
  expect(result.measurement.tokens).toBe(result.text.length);
  expect((await meter.measure([], config)).measurement.tokens).toBe(2);
});
it('keys completed caches by actual text and tokenizer, handles separators/order, and can disable caching', async () => {
  let calls = 0;
  const count = (text: string) => {
    calls++;
    return Promise.resolve(text.length);
  };
  const resolveCounter = (ref: string) => testCounter(ref, count);
  const meter = new MemoryMeter({ resolveCounter, maxCacheEntries: 10 });
  const config = resolveMemoryConfig({ measurementRef: 'v1' });
  const items = [
    { id: 'a', content: 'a' },
    { id: 'b', content: 'b' },
  ];
  const first = await meter.measure(items, config);
  const initial = calls;
  expect((await meter.measure(items, config)).measurement).toEqual(first.measurement);
  expect(calls).toBe(initial);
  expect(
    (await meter.measure(items, { ...config, render: { format: 'text', separator: '--' } }))
      .measurement.tokens
  ).toBe(4);
  expect((await meter.measure([...items].reverse(), config)).text).toBe('b\na');
  await meter.measure(items, { ...config, measurementRef: 'v2' });
  expect(calls).toBeGreaterThan(initial);
  const uncached = new MemoryMeter({ resolveCounter, maxCacheEntries: 0 });
  const before = calls;
  await uncached.measure(items, config);
  await uncached.measure(items, config);
  expect(calls - before).toBe(6);
});
it('enforces real counts despite forged stored hints, and reports unbounded reads without fake success', async () => {
  const store = new TestMemoryStore();
  const meter = new MemoryMeter({ counter: testCounter() });
  const mutations = new MemoryMutations({ store, meter, defaults: { measurementRef: 'chars' } });
  await mutations.create({
    memoryId: 'a',
    requestId: 'c',
    items: [{ content: 'abc' }],
    config: { maxContextTokens: null },
  });
  const snapshot = store.snapshots.get('a');
  if (snapshot === undefined) throw new Error('missing fixture');
  store.snapshots.set('a', {
    ...snapshot,
    measurement: { ...snapshot.measurement, tokens: 0 },
  });
  const result = await readMemoryContext({ store, meter }, { memoryId: 'a' });
  expect(result.measurement.tokens).toBe(3);
  expect(result.budget.status).toBe('unbounded');
  await expect(
    mutations.configure({
      memoryId: 'a',
      requestId: 'budget',
      expectedRevision: 1,
      config: { maxContextTokens: 1 },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
});
