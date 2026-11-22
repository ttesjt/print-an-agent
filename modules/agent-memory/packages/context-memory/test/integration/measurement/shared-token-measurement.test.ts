import { expect, it, vi } from 'vitest';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  MemoryMeter,
  MemoryMutations,
  parseMemorySnapshot,
  readMemoryContext,
} from '@print-an-agent/context-memory';
import { TestMemoryStore } from '../../support/store.js';
import { testCounter } from '../../support/counter.js';

function fixture() {
  const measure = vi.fn(() => Promise.resolve({ tokens: 2, accuracy: 'estimated' as const }));
  const counter = createTokenCounter({
    measurementRef: 'test:estimate',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure,
  });
  const meter = new MemoryMeter({ counter });
  const store = new TestMemoryStore();
  const mutations = new MemoryMutations({
    store,
    meter,
    defaults: { measurementRef: counter.descriptor.measurementRef },
  });
  return { measure, counter, meter, store, mutations };
}

it.each([{ maxContextTokens: 100 }, { maxContextTokens: null, maxItemTokens: 100 }])(
  'rejects estimated measurements before publishing a finite-budget document %j',
  async (config) => {
    const { store, mutations } = fixture();
    await expect(
      mutations.create({ memoryId: 'm', requestId: 'r', config, items: [{ content: 'x' }] })
    ).rejects.toMatchObject({
      code: 'TOKEN_MEASUREMENT_INEXACT',
      commit: { status: 'not-committed' },
    });
    expect(store.commits).toBe(0);
  }
);

it('retains metadata through persistence and caching, and never promotes a report into hard-budget proof', async () => {
  const { store, meter, mutations, measure } = fixture();
  await mutations.create({
    memoryId: 'm',
    requestId: 'r',
    config: { maxContextTokens: null },
    items: [{ content: 'x' }],
  });
  const stored = parseMemorySnapshot(await store.read('m'));
  expect(stored.measurement).toMatchObject({
    accuracy: 'estimated',
    scope: 'text',
    inputProtocolRef: TEXT_TOKEN_INPUT_CONTRACT.ref,
    measurementRef: 'test:estimate',
    tokens: 2,
  });
  const before = measure.mock.calls.length;
  const report = await readMemoryContext(
    { store, meter },
    { memoryId: 'm', maxTokens: 1, budgetPolicy: 'report' }
  );
  expect(report.budget.status).toBe('exceeded');
  expect(report.measurement.accuracy).toBe('estimated');
  await expect(
    readMemoryContext({ store, meter }, { memoryId: 'm', maxTokens: 100 })
  ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_INEXACT' });
  expect(measure).toHaveBeenCalledTimes(before);
  const incomplete = Object.fromEntries(
    Object.entries(stored.measurement).filter(([key]) => key !== 'accuracy')
  );
  expect(() => parseMemorySnapshot({ ...stored, measurement: incomplete })).toThrow();
});

it('requires the configured identity and does not resolve aliases or fall back to another counter', async () => {
  const meter = new MemoryMeter({ counter: testCounter('test:actual') });
  await expect(
    meter.measure([], {
      measurementRef: 'test:requested',
      render: { format: 'text', separator: '' },
      maxContextTokens: null,
      maxItems: null,
      maxItemTokens: null,
      compactionTarget: { maxTokens: 1 },
    })
  ).rejects.toMatchObject({ code: 'TOKENIZER_UNAVAILABLE' });
});

it('requires exact item measurements as well as exact rendered text for an item budget', async () => {
  const store = new TestMemoryStore();
  const counter = createTokenCounter({
    measurementRef: 'test:mixed',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) =>
      Promise.resolve({ tokens: 1, accuracy: input.text.includes('\n') ? 'exact' : 'estimated' }),
  });
  const mutations = new MemoryMutations({
    store,
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: 'test:mixed', maxItemTokens: 100 },
  });
  await expect(
    mutations.create({ memoryId: 'm', requestId: 'r', items: [{ content: 'a' }, { content: 'b' }] })
  ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_INEXACT' });
  expect(store.commits).toBe(0);
});
