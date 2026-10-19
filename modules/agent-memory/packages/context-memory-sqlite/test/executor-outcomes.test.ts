import { expect, it } from 'vitest';
import {
  ContextMemoryError,
  createContextMemoryBundle,
  createContextMemoryResources,
  createMemoryApplyDefinition,
  createMemoryEditDefinition,
} from '@ta-agent/context-memory';
import { borrowed } from './support/fixtures.js';
import { modelFixture } from './support/model.js';

it.each(['executeOperation', 'runMemoryOperation'])(
  'preserves apply receipts when Executor post-processing fails for %s',
  async (failedStep) => {
    const base = borrowed();
    const cleanup = new ContextMemoryError('CLEANUP_FAILED', 'Executor cleanup failed.');
    const bundle = createContextMemoryBundle({
      resources: createContextMemoryResources({
        store: base.store,
        meter: base.meter,
        defaults: { measurementRef: 'chars' },
      }),
      workflows: {
        apply: createMemoryApplyDefinition({
          executeStep: async ({ stepName, step, context }) => {
            await step(context);
            if (stepName === failedStep) throw cleanup;
          },
        }),
      },
    });
    await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    const input = {
      memoryId: 'a',
      requestId: 'apply',
      expectedRevision: 1,
      commands: [{ op: 'add' as const, content: 'learned' }],
    };
    const failure = await bundle.workflows.apply.run({ input }).catch((cause: unknown) => cause);
    const receipt = await base.store.getReceipt('a', 'apply');
    expect(receipt).toMatchObject({ revision: 2 });
    expect(failure).toMatchObject({
      code: 'CLEANUP_FAILED',
      cause: cleanup,
      commit: { status: 'committed', receipt },
    });
    expect((await base.store.read('a'))?.revision).toBe(2);
    expect(await base.mutations.apply(input)).toMatchObject({
      status: 'committed',
      receipt: { revision: 2 },
    });
  }
);

it.each([
  { failedStep: 'commitCandidate', abort: false, plainError: false },
  { failedStep: 'runModelOperation', abort: false, plainError: false },
  { failedStep: 'commitCandidate', abort: true, plainError: true },
])(
  'preserves edit receipts after $failedStep failure (late abort: $abort)',
  async ({ failedStep, abort, plainError }) => {
    const controller = new AbortController();
    const cleanup = plainError
      ? new Error('Executor cleanup failed.')
      : new ContextMemoryError('CLEANUP_FAILED', 'Executor cleanup failed.', {
          commit: { status: 'not-committed' },
        });
    const fixture = modelFixture(() => [{ op: 'add', content: 'learned' }], {
      workflows: {
        edit: createMemoryEditDefinition({
          executeStep: async ({ stepName, step, context }) => {
            await step(context);
            if (stepName === failedStep) {
              if (abort) controller.abort();
              throw cleanup;
            }
          },
        }),
      },
    });
    await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    const input = { memoryId: 'a', requestId: 'edit', instruction: 'learn' };
    await expect(
      fixture.bundle.workflows.edit.run({ input, signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      cause: cleanup,
      commit: { status: 'committed', receipt: { memoryId: 'a', requestId: 'edit', revision: 2 } },
    });
    expect((await fixture.store.read('a'))?.revision).toBe(2);
    expect(await fixture.store.getReceipt('a', 'edit')).toMatchObject({ revision: 2 });
    const replay = createContextMemoryBundle({ resources: fixture.resources });
    expect(await replay.workflows.edit.run({ input })).toMatchObject({
      status: 'committed',
      receipt: { revision: 2 },
    });
    expect(fixture.requests).toHaveLength(1);
  }
);

it('preserves unchanged terminal receipts, including the original result on replay', async () => {
  const fixture = modelFixture(() => [], {
    workflows: {
      edit: createMemoryEditDefinition({
        executeStep: async ({ stepName, step, context }) => {
          await step(context);
          if (stepName === 'runModelOperation') throw new Error('Post-processing failed.');
        },
      }),
    },
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'review' };
  for (let replay = 0; replay < 2; replay++) {
    await expect(fixture.bundle.workflows.edit.run({ input })).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { status: 'unchanged', revision: 1 } },
    });
  }
  expect(fixture.requests).toHaveLength(1);
  expect((await fixture.store.read('a'))?.revision).toBe(1);
});

it('does not invent a committed receipt for an Executor failure before the mutation', async () => {
  const failure = new ContextMemoryError('CLEANUP_FAILED', 'Pre-processing failed.', {
    commit: { status: 'not-committed' },
  });
  const fixture = modelFixture(() => [], {
    workflows: {
      edit: createMemoryEditDefinition({
        executeStep: async ({ stepName, step, context }) => {
          if (stepName === 'planUpdate') throw failure;
          await step(context);
        },
      }),
    },
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    fixture.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'review' },
    })
  ).rejects.toBe(failure);
  expect(await fixture.store.getReceipt('a', 'edit')).toBeUndefined();
  expect((await fixture.store.read('a'))?.revision).toBe(1);
});
