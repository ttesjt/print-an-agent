import { expect, it } from 'vitest';
import { consumer } from './support/model.js';
import { memoryPath, ownedStore, gate } from './support/storage.js';

it('replans against another connection’s new snapshot/config without changing the business input', async () => {
  const path = await memoryPath();
  const entered = gate();
  const release = gate();
  let plans = 0;
  const first = consumer(ownedStore(path), async () => {
    if (++plans === 1) {
      entered.release();
      await release.promise;
    }
    return [{ op: 'add', content: 'learned' }];
  });
  const second = consumer(ownedStore(path));
  await first.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'original input' };
  const pending = first.bundle.workflows.edit.run({ input });
  try {
    await entered.promise;
    input.instruction = 'caller modified its object';
    await second.bundle.workflows.apply.run({
      input: {
        memoryId: 'a',
        requestId: 'external',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'external' }],
      },
    });
    await second.bundle.workflows.configure.run({
      input: {
        memoryId: 'a',
        requestId: 'config',
        expectedRevision: 2,
        config: { render: { format: 'text', separator: '|' } },
      },
    });
    release.release();
    await pending;
    expect(first.actor.requests.map((request) => request.instruction)).toEqual([
      'original input',
      'original input',
    ]);
    expect(first.actor.requests[1]?.source[0]?.content).toBe('external');
    expect(
      await first.bundle.workflows.readContext.run({ input: { memoryId: 'a' } })
    ).toMatchObject({
      text: 'external|learned',
      snapshot: { revision: 4 },
    });
  } finally {
    release.release();
    await Promise.allSettled([pending]);
  }
});

it('arbitrates same-request races across independent consumers, returning the winning IDs to both', async () => {
  const path = await memoryPath();
  const entered = gate();
  const release = gate();
  const first = consumer(ownedStore(path), async () => {
    entered.release();
    await release.promise;
    return [{ op: 'add', content: 'first candidate' }];
  });
  const second = consumer(ownedStore(path), () => [{ op: 'add', content: 'winning candidate' }]);
  await first.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'shared', instruction: 'remember' };
  const pending = first.bundle.workflows.edit.run({ input });
  try {
    await entered.promise;
    const winner = await second.bundle.workflows.edit.run({ input });
    release.release();
    expect(await pending).toEqual(winner);
    expect(
      await first.bundle.workflows.readContext.run({ input: { memoryId: 'a' } })
    ).toMatchObject({
      text: 'winning candidate',
      snapshot: { revision: 2 },
    });
    expect(first.actor.requests).toHaveLength(1);
    expect(second.actor.requests).toHaveLength(1);
  } finally {
    release.release();
    await Promise.allSettled([pending]);
  }
});
