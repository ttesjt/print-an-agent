import { createResourceScope } from '@ta-agent/base-composition/resource-registry';
import { expect, it } from 'vitest';
import {
  bindMemoryFactories,
  compileMemoryRecipe,
  defineMemoryRecipe,
} from './examples/memory-composition.js';
import { modelFixture } from './support/models.js';
import { ownScope, paths } from './support/ownership.js';

it('assembles both native Bundles lazily, sharing capabilities across independent management/runtime factories', async () => {
  const models = modelFixture();
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const locations = await paths();
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const management = bindMemoryFactories(recipe, scope, locations);
  const runtime = bindMemoryFactories(recipe, scope, locations);
  expect(models.created).toEqual({ completion: 0, embedding: 0 });
  const [context, sameContext, retrieval, sameRetrieval] = await Promise.all([
    management.context(),
    runtime.context(),
    management.retrieval(),
    runtime.retrieval(),
  ]);
  expect(context).toBe(sameContext);
  expect(retrieval).toBe(sameRetrieval);
  expect(() => recipe.tokens.context.accept(retrieval, locations.context)).toThrow(
    'A resource does not satisfy its contract.'
  );
  expect(() => recipe.tokens.retrieval.accept(context, locations.retrieval)).toThrow(
    'A resource does not satisfy its contract.'
  );
  expect(models.created).toEqual({ completion: 1, embedding: 1 });
  expect(models.completions).toHaveLength(0);
  expect(models.embeddings).toHaveLength(0);
  const index = await management.index();
  for (const memoryId of ['project:a', 'session:b']) {
    await context.workflows.create.run({ input: { memoryId, requestId: 'create' } });
    await retrieval.workflows.create.run({ input: { memoryId, requestId: 'create', index } });
  }
  await sameContext.workflows.edit.run({
    input: { memoryId: 'project:a', requestId: 'edit', instruction: 'Prefer tea.' },
  });
  expect(
    (await context.workflows.readContext.run({ input: { memoryId: 'project:a' } }))?.text
  ).toBe('Prefer tea.');
  expect(
    (await context.workflows.readContext.run({ input: { memoryId: 'session:b' } }))?.text
  ).toBe('');
  const committed = await sameRetrieval.workflows.ingest.run({
    input: {
      memoryId: 'project:a',
      requestId: 'ingest',
      content: 'tea preference',
      metadata: { topic: 'drink' },
    },
  });
  expect(committed).toMatchObject({ status: 'committed' });
  const search = await retrieval.workflows.search.run({
    input: {
      memoryId: 'project:a',
      query: 'tea',
      filter: { op: 'eq', path: ['topic'], value: 'drink' },
    },
  });
  expect(search).toMatchObject({
    status: 'completed',
    value: { hits: [{ text: 'tea preference' }] },
  });
  expect(await retrieval.workflows.list.run({ input: { memoryId: 'session:b' } })).toMatchObject({
    status: 'completed',
    value: { entries: [] },
  });
  expect(
    await retrieval.workflows.readContext.run({
      input: { memoryId: 'project:a', query: 'tea', maxTokens: 128 },
    })
  ).toMatchObject({
    status: 'completed',
    value: { outcome: 'selected', citations: [{ number: 1 }] },
  });
  await scope.close();
  expect(models.active).toBe(0);
  expect(models.released).toEqual({ completion: 1, embedding: 1 });
  await expect(runtime.context()).rejects.toMatchObject({ code: 'RESOURCE_SCOPE_CLOSED' });
});

it('uses new scopes against durable authority without treating object identity as durable state', async () => {
  const locations = await paths();
  const models = modelFixture();
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const firstScope = ownScope(createResourceScope(recipe.blueprint));
  const first = bindMemoryFactories(recipe, firstScope, locations);
  const bundle = await first.context();
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'persisted' }] },
  });
  await firstScope.close();
  const secondScope = ownScope(createResourceScope(recipe.blueprint));
  const second = await bindMemoryFactories(recipe, secondScope, locations).context();
  expect(second).not.toBe(bundle);
  expect((await second.workflows.readContext.run({ input: { memoryId: 'a' } }))?.text).toBe(
    'persisted'
  );
  expect(models.completions).toHaveLength(0);
});
