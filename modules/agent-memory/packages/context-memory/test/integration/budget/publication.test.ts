import { expect, it } from 'vitest';
import {
  createModelMemoryResources,
  MemoryMeter,
  MemoryMutations,
} from '@print-an-agent/context-memory';
import { TestMemoryStore } from '../../support/store.js';
import { testCounter } from '../../support/counter.js';

it.each([
  { maxItems: 1, maxItemTokens: 3, kind: 'items' },
  { maxItems: null, maxItemTokens: 3, kind: 'item-tokens' },
  { maxItems: null, maxItemTokens: null, kind: 'context-tokens' },
])(
  'keeps candidate assessment and both publication paths consistent with $kind error priority',
  async ({ maxItems, maxItemTokens, kind }) => {
    const store = new TestMemoryStore();
    const meter = new MemoryMeter({ counter: testCounter('characters') });
    let nextId = 0;
    const options = {
      store,
      meter,
      defaults: { measurementRef: 'characters' },
      createItemId: () => 'item-' + ++nextId,
    };
    const mutations = new MemoryMutations(options);
    await mutations.create({
      memoryId: 'notes',
      requestId: 'create',
      items: [{ content: 'abc' }],
      config: { maxContextTokens: 4, maxItems, maxItemTokens },
    });
    const resources = createModelMemoryResources({
      ...options,
      planner: { plan: () => Promise.resolve([]) },
    });
    const signal = new AbortController().signal;
    const started = await resources.updates.begin(
      'edit',
      { memoryId: 'notes', requestId: 'model-edit', instruction: 'Add a longer note' },
      signal
    );
    if (started.status === 'replayed') throw new Error('Expected a fresh candidate.');
    started.update.edit([{ op: 'add', content: 'long' }]);
    const assessment = await started.update.assess(signal);
    expect(assessment.accepted).toBe(false);
    expect(assessment.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind })])
    );
    await expect(started.update.commit(signal)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      details: { kind },
    });
    await expect(
      mutations.apply({
        memoryId: 'notes',
        requestId: 'apply',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'long' }],
      })
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', details: { kind } });
    expect((await store.read('notes'))?.revision).toBe(1);
    expect(await store.getReceipt('notes', 'model-edit')).toBeUndefined();
    expect(await store.getReceipt('notes', 'apply')).toBeUndefined();
  }
);
