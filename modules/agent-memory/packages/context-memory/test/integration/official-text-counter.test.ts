import { expect, it } from 'vitest';
import {
  createTiktokenTextCounter,
  TIKTOKEN_ENCODING,
} from '@ta-agent/model-invocation-token-counters';
import { MemoryMeter, MemoryMutations, readMemoryContext } from '@ta-agent/context-memory';
import { TestMemoryStore } from '../support/store.js';

it('enforces an independent Memory budget through an official exact counter without Agent or model I/O', async () => {
  const counter = createTiktokenTextCounter({ encoding: TIKTOKEN_ENCODING.CL100K_BASE });
  const meter = new MemoryMeter({ counter });
  const store = new TestMemoryStore();
  const mutations = new MemoryMutations({
    store,
    meter,
    defaults: { measurementRef: counter.descriptor.measurementRef, maxContextTokens: 2 },
  });
  await mutations.create({
    memoryId: 'm',
    requestId: 'create',
    items: [{ content: 'hello world' }],
  });
  const context = await readMemoryContext({ store, meter }, { memoryId: 'm' });
  expect(context.measurement).toMatchObject({ tokens: 2, accuracy: 'exact', scope: 'text' });
  await expect(
    mutations.apply({
      memoryId: 'm',
      requestId: 'grow',
      expectedRevision: 1,
      commands: [{ op: 'add', content: 'another distinct thought' }],
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect((await store.read('m'))?.revision).toBe(1);
});
