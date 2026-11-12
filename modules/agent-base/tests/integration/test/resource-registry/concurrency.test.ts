import { createResourceScope } from '@print-an-agent/base-composition/resource-registry';
import { createMemoryEditDefinition } from '@print-an-agent/context-memory';
import { expect, it } from 'vitest';
import {
  defineMemoryRecipe,
  compileMemoryRecipe,
  bindMemoryFactories,
} from './examples/memory-composition.js';
import { modelFixture, instruction } from './support/models.js';
import { ownScope, paths } from './support/ownership.js';
import { customContextBundle } from './support/context-bundle.js';

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('Model cancelled'));
    else
      signal.addEventListener('abort', () => reject(new Error('Model cancelled')), { once: true });
  });
}

it('isolates concurrent Run state and cancellation on a shared Bundle and Completion', async () => {
  const both = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const runs: { readonly id: string; readonly state: object; readonly signal: AbortSignal }[] = [];
  let entered = 0;
  const models = modelFixture({
    plan: async (request) => {
      if (++entered === 2) both.resolve();
      if (instruction(request) === 'cancel') return untilAborted(request.signal);
      await finish.promise;
      return [{ op: 'add', content: 'kept' }];
    },
  });
  const recipe = compileMemoryRecipe(
    defineMemoryRecipe(models.recipes, {
      contextBundle: (resources) =>
        customContextBundle(
          resources,
          createMemoryEditDefinition({
            executeStep: async ({ stepName, step, context }) => {
              if (stepName === 'prepareInput') {
                expect(context.resources).not.toHaveProperty('registry');
                runs.push({
                  id: context.workflowRunId,
                  state: context.state,
                  signal: context.signal,
                });
              }
              await step(context);
            },
          })
        ),
    })
  );
  const locations = await paths();
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const management = await bindMemoryFactories(recipe, scope, locations).context();
  const runtime = await bindMemoryFactories(recipe, scope, locations).context();
  for (const memoryId of ['cancel', 'keep'])
    await management.workflows.create.run({ input: { memoryId, requestId: 'create' } });
  const controller = new AbortController();
  const cancelled = runtime.workflows.edit.run({
    input: { memoryId: 'cancel', requestId: 'edit', instruction: 'cancel' },
    signal: controller.signal,
  });
  const rejected = expect(cancelled).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
    commit: { status: 'not-committed' },
  });
  const kept = management.workflows.edit.run({
    input: { memoryId: 'keep', requestId: 'edit', instruction: 'keep' },
  });
  try {
    await both.promise;
    controller.abort();
    await rejected;
    expect(models.active).toBe(1);
    expect(scope.state).toBe('open');
    expect(models.released.completion).toBe(0);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.id).not.toBe(runs[1]?.id);
    expect(runs[0]?.state).not.toBe(runs[1]?.state);
    expect(runs[0]?.signal).not.toBe(runs[1]?.signal);
    expect(
      models.completions.find((request) => instruction(request) === 'keep')?.signal.aborted
    ).toBe(false);
    finish.resolve();
    await expect(kept).resolves.toMatchObject({
      status: 'committed',
      receipt: { memoryId: 'keep', revision: 2 },
    });
    expect((await runtime.workflows.readContext.run({ input: { memoryId: 'cancel' } }))?.text).toBe(
      ''
    );
    expect((await runtime.workflows.readContext.run({ input: { memoryId: 'keep' } }))?.text).toBe(
      'kept'
    );
    await scope.close();
    expect(models.released.completion).toBe(1);
  } finally {
    controller.abort();
    finish.resolve();
    await Promise.allSettled([cancelled, kept]);
  }
});

it('keeps deterministic CAS and model conflict replanning on shared instances without confusing requests', async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const models = modelFixture({
    plan: async () => {
      if (models.completions.length === 1) {
        entered.resolve();
        await finish.promise;
      }
      return [{ op: 'add', content: 'learned' }];
    },
  });
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const locations = await paths();
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const management = await bindMemoryFactories(recipe, scope, locations).context();
  const runtime = await bindMemoryFactories(recipe, scope, locations).context();
  await management.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const edit = runtime.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'model', instruction: 'same instruction' },
  });
  try {
    await entered.promise;
    const outcomes = await Promise.allSettled(
      ['one', 'two'].map((requestId) =>
        management.workflows.apply.run({
          input: {
            memoryId: 'a',
            requestId,
            expectedRevision: 1,
            commands: [{ op: 'add', content: requestId }],
          },
        })
      )
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'REVISION_CONFLICT' },
    });
    finish.resolve();
    await expect(edit).resolves.toMatchObject({ status: 'committed', receipt: { revision: 3 } });
    expect(models.completions).toHaveLength(2);
    expect(models.completions.map(instruction)).toEqual(['same instruction', 'same instruction']);
    const snapshot = await runtime.workflows.readContext.run({ input: { memoryId: 'a' } });
    expect(snapshot?.snapshot.items.map((item) => item.content)).toContain('learned');
    expect(snapshot?.snapshot.items).toHaveLength(2);
  } finally {
    finish.resolve();
    await Promise.allSettled([edit]);
  }
});

it('cancels only one embedding Run while another Retrieval mutation commits through the same worker and capability', async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const models = modelFixture({
    embed: async (request) => {
      if (request.inputs[0]?.text === 'cancel') {
        entered.resolve();
        return untilAborted(request.signal);
      }
      await finish.promise;
      return request.inputs.map((input) => ({ id: input.id, vector: [1, 0, 0, 0] }));
    },
  });
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const locations = await paths();
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const factories = bindMemoryFactories(recipe, scope, locations);
  const bundle = await factories.retrieval();
  const index = await factories.index();
  for (const memoryId of ['a', 'b'])
    await bundle.workflows.create.run({ input: { memoryId, requestId: 'create', index } });
  const controller = new AbortController();
  const cancelled = bundle.workflows.ingest.run({
    input: { memoryId: 'a', requestId: 'cancel', content: 'cancel' },
    signal: controller.signal,
  });
  const rejected = expect(cancelled).rejects.toBeDefined();
  const kept = bundle.workflows.ingest.run({
    input: { memoryId: 'b', requestId: 'kept', content: 'keep' },
  });
  try {
    await entered.promise;
    controller.abort();
    await rejected;
    finish.resolve();
    await expect(kept).resolves.toMatchObject({ status: 'committed' });
    expect(await bundle.workflows.list.run({ input: { memoryId: 'a' } })).toMatchObject({
      value: { entries: [] },
    });
    expect(await bundle.workflows.list.run({ input: { memoryId: 'b' } })).toMatchObject({
      value: { entries: [{ memoryId: 'b' }] },
    });
    expect(models.created.embedding).toBe(1);
    expect(models.active).toBe(0);
  } finally {
    controller.abort();
    finish.resolve();
    await Promise.allSettled([cancelled, kept]);
  }
});
