import { expect, it } from 'vitest';
import {
  createContextMemoryBundle,
  createContextMemoryResources,
  MemoryMeter,
} from '@ta-agent/context-memory';
import { testCounter } from './support/counter.js';
import { gate, TestMemoryStore } from './support/store.js';

it('isolates run state and cancellation between memories and Bundles sharing resources', async () => {
  const entered = gate();
  const release = gate();
  const store = new TestMemoryStore();
  const meter = new MemoryMeter({
    counter: testCounter('chars', async (text) => {
      if (text === 'hold') {
        entered.release();
        await release.promise;
      }
      return text.length;
    }),
  });
  const resources = createContextMemoryResources({
    store,
    meter,
    defaults: { measurementRef: 'chars' },
  });
  const a = createContextMemoryBundle({ resources });
  const b = createContextMemoryBundle({ resources });
  const controller = new AbortController();
  const pending = a.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'hold' }] },
    signal: controller.signal,
  });
  await entered.promise;
  expect(
    await b.workflows.create.run({
      input: { memoryId: 'b', requestId: 'create', items: [{ content: 'other' }] },
    })
  ).toMatchObject({ status: 'committed' });
  controller.abort();
  release.release();
  await expect(pending).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
  expect(await a.workflows.readContext.run({ input: { memoryId: 'b' } })).toMatchObject({
    text: 'other',
  });
  expect(await store.read('a')).toBeUndefined();
});
