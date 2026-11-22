import { expect, it } from 'vitest';

import {
  createContextMemoryBundle,
  createModelMemoryResources,
} from '@print-an-agent/context-memory';

import { modelFixture } from '../../../support/model.js';

import { borrowed, gate, FaultDatabase } from '../../../support/fixtures.js';

it('arbitrates identical concurrent model requests with one durable result and generated identity', async () => {
  const entered = gate();
  const release = gate();
  const fixture = modelFixture(async (_request, call) => {
    if (call === 1) {
      entered.release();
      await release.promise;
    }
    return [{ op: 'add', content: 'learned' }];
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'learn' };
  const first = fixture.bundle.workflows.edit.run({ input });
  await entered.promise;
  const second = await fixture.bundle.workflows.edit.run({ input });
  release.release();
  expect(await first).toEqual(second);
  expect(fixture.requests).toHaveLength(2);
  const snapshot = await fixture.store.read('a');
  expect(snapshot?.revision).toBe(2);
  expect(snapshot?.items).toHaveLength(1);
  const replay = await fixture.bundle.workflows.edit.run({ input });
  expect(replay).toEqual(second);
  expect(fixture.requests).toHaveLength(2);
  await expect(
    fixture.bundle.workflows.edit.run({ input: { ...input, instruction: 'different' } })
  ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
});

it('preserves model commit facts when cancellation arrives immediately after SQLite COMMIT', async () => {
  const database = new FaultDatabase(':memory:');
  const base = borrowed(database);
  const bundle = createContextMemoryBundle({
    resources: createModelMemoryResources({
      store: base.store,
      meter: base.meter,
      defaults: { measurementRef: 'chars' },
      planner: { plan: () => Promise.resolve([{ op: 'add', content: 'learned' }]) },
    }),
  });
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const controller = new AbortController();
  database.afterCommit = () => controller.abort();
  const result = await bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'learn' },
    signal: controller.signal,
  });
  expect(result).toMatchObject({ status: 'committed', receipt: { revision: 2 } });
  if (result.status === 'skipped') throw new Error('Expected a committed result.');
  expect(await base.store.getReceipt('a', 'edit')).toEqual(result.receipt);
});
