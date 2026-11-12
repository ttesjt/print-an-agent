import { createResourceScope } from '@print-an-agent/base-composition/resource-registry';
import { expect, it } from 'vitest';
import {
  bindMemoryFactories,
  compileMemoryRecipe,
  defineMemoryRecipe,
} from './examples/memory-composition.js';
import { contextStoreProvider, retrievalBackendProvider } from './support/fault-providers.js';
import { modelFixture } from './support/models.js';
import { ownScope, paths } from './support/ownership.js';

it('recovers a lost Context commit reply through a fresh Scope without replanning or duplicating items', async () => {
  const locations = await paths();
  const models = modelFixture();
  const definition = defineMemoryRecipe(models.recipes);
  const store = contextStoreProvider(definition, { dropEditReply: true });
  const recipe = compileMemoryRecipe({
    ...definition,
    providers: { ...definition.providers, contextStore: store.provider },
  });
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const bundle = await bindMemoryFactories(recipe, scope, locations).context();
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'lost', instruction: 'durable' };
  await expect(bundle.workflows.edit.run({ input })).rejects.toMatchObject({
    code: 'COMMIT_STATUS_UNKNOWN',
    commit: { status: 'unknown', memoryId: 'a', requestId: 'lost' },
  });
  expect(models.completions).toHaveLength(1);
  await scope.close();
  const reopenedScope = ownScope(createResourceScope(recipe.blueprint));
  const reopened = await bindMemoryFactories(recipe, reopenedScope, locations).context();
  const receipt = await reopened.workflows.getReceipt.run({
    input: { memoryId: 'a', requestId: 'lost' },
  });
  expect(receipt).toMatchObject({ revision: 2 });
  expect(await reopened.workflows.edit.run({ input })).toEqual({ status: 'committed', receipt });
  expect(
    (await reopened.workflows.readContext.run({ input: { memoryId: 'a' } }))?.snapshot.items
  ).toHaveLength(1);
  expect(models.completions).toHaveLength(1);
  expect(store.commits).toBe(2); // create + edit, no replay write
});

it('recovers a lost Retrieval publication reply through a fresh worker/Scope without re-embedding', async () => {
  const locations = await paths();
  const models = modelFixture();
  const definition = defineMemoryRecipe(models.recipes);
  const backend = retrievalBackendProvider(definition);
  const recipe = compileMemoryRecipe({
    ...definition,
    providers: { ...definition.providers, retrievalBackend: backend.provider },
  });
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const factory = bindMemoryFactories(recipe, scope, locations);
  const bundle = await factory.retrieval();
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', index: await factory.index() },
  });
  const input = { memoryId: 'a', requestId: 'lost', content: 'tea' };
  await expect(bundle.workflows.ingest.run({ input })).rejects.toMatchObject({
    code: 'COMMIT_UNKNOWN',
    commit: { status: 'unknown' },
  });
  expect(models.embeddings).toHaveLength(1);
  await scope.close();
  const reopenedScope = ownScope(createResourceScope(recipe.blueprint));
  const reopened = await bindMemoryFactories(recipe, reopenedScope, locations).retrieval();
  const receipt = await reopened.workflows.getReceipt.run({
    input: { memoryId: 'a', requestId: 'lost' },
  });
  expect(receipt).toMatchObject({ status: 'completed', value: { sequence: 1 } });
  const replay = await reopened.workflows.ingest.run({ input });
  expect(replay).toMatchObject({ status: 'committed', receipt: { sequence: 1 } });
  expect(await reopened.workflows.list.run({ input: { memoryId: 'a' } })).toMatchObject({
    value: { entries: [{ memoryId: 'a' }] },
  });
  expect(models.embeddings).toHaveLength(1);
  expect(backend.publications).toBe(2);
});

it('lets Host join business execution before releasing resources and preserves the commit beside a cleanup failure', async () => {
  const locations = await paths();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const cleanup = new Error('Injected post-close failure');
  let joined = false;
  let failClose = true;
  const models = modelFixture({
    plan: async () => {
      entered.resolve();
      await finish.promise;
      return [{ op: 'add', content: 'committed' }];
    },
    releaseCompletion: () => {
      expect(joined).toBe(true);
      expect(models.active).toBe(0);
    },
  });
  const definition = defineMemoryRecipe(models.recipes);
  const store = contextStoreProvider(definition, {
    afterClose: () => {
      expect(joined).toBe(true);
      if (failClose) {
        failClose = false;
        throw cleanup;
      }
    },
  });
  const recipe = compileMemoryRecipe({
    ...definition,
    providers: { ...definition.providers, contextStore: store.provider },
  });
  // This test knows the injected failure occurs after actual SQLite close. No live resource is abandoned.
  const scope = ownScope(createResourceScope(recipe.blueprint), true);
  const bundle = await bindMemoryFactories(recipe, scope, locations).context();
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'remember' };
  const execution = bundle.workflows.edit.run({ input });
  await entered.promise;
  // Local Host policy, not a new Registry executor. A returned capability's business task is ours to join.
  const shutdown = (async () => {
    const result = await execution;
    joined = true;
    const cleanupResult = await scope.close().then(
      () => undefined,
      (cause: unknown) => cause
    );
    return { result, cleanup: cleanupResult };
  })();
  try {
    expect(store.releases).toBe(0);
    expect(models.released.completion).toBe(0);
    finish.resolve();
    const outcome = await shutdown;
    expect(outcome.result).toEqual(await execution);
    expect(outcome.result).toMatchObject({ status: 'committed', receipt: { revision: 2 } });
    expect(outcome.cleanup).toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      failures: [{ failures: [cleanup] }],
    });
    expect(store.releases).toBe(1);
    expect(models.released.completion).toBe(1);
    const reopenedScope = ownScope(createResourceScope(recipe.blueprint));
    const reopened = await bindMemoryFactories(recipe, reopenedScope, locations).context();
    expect(await reopened.workflows.edit.run({ input })).toEqual(outcome.result);
    expect(models.completions).toHaveLength(1);
    expect(store.commits).toBe(2);
  } finally {
    finish.resolve();
    await Promise.allSettled([execution, shutdown]);
  }
});
