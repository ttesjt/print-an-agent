import { expect, it } from 'vitest';
import { createMemoryEditDefinition, ContextMemoryError } from '@ta-agent/context-memory';
import { consumer } from './support/model.js';
import { ownedStore, memoryPath } from './support/storage.js';

it('retains independent Executor and hook failures alongside the same committed receipt', async () => {
  const first = new Error('Executor post-processing failed.');
  const second = new Error('Hook cleanup failed.');
  const store = ownedStore(await memoryPath());
  const client = consumer(store, () => [{ op: 'add', content: 'new' }], {
    workflows: {
      edit: createMemoryEditDefinition({
        executeStep: async ({ stepName, step, context }) => {
          await step(context);
          if (stepName === 'commitCandidate') throw first;
        },
        lifecycle: {
          onFinally: () => {
            throw second;
          },
        },
      }),
    },
  });
  await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'change' };
  const failure: unknown = await client.bundle.workflows.edit
    .run({ input })
    .catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) throw new Error('Expected separate failures.');
  const errors: unknown[] = failure.errors;
  expect(errors).toHaveLength(2);
  const receipt = await store.getReceipt('a', 'edit');
  for (const error of errors) {
    expect(error).toBeInstanceOf(ContextMemoryError);
    expect(error).toMatchObject({ commit: { status: 'committed', receipt } });
  }
  expect(errors.map((error) => (error instanceof Error ? error.cause : undefined))).toEqual([
    first,
    second,
  ]);
  const recovery = consumer(store, () => {
    throw new Error('A known commit cannot replan.');
  });
  expect(await recovery.bundle.workflows.edit.run({ input })).toEqual({
    status: 'committed',
    receipt,
  });
  expect(recovery.actor.requests).toHaveLength(0);
});
