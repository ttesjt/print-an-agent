import {
  borrowResource,
  createResourceScope,
  defineResourceProvider,
} from '@print-an-agent/base-composition/resource-registry';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import { createMemoryEditDefinition } from '@print-an-agent/context-memory';
import { expect, it, vi } from 'vitest';
import {
  bindMemoryFactories,
  compileMemoryRecipe,
  defineMemoryRecipe,
} from './examples/memory-composition.js';
import { describeResource } from './examples/tokens.js';
import { customContextBundle } from './support/context-bundle.js';
import { modelFixture } from './support/models.js';
import { ownScope, paths } from './support/ownership.js';

it('borrows a different counter without taking ownership or weakening the final Memory budget', async () => {
  const locations = await paths();
  const models = modelFixture();
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const close = vi.fn();
  // Exact for this test's codepoint protocol, not a real model tokenizer claim.
  const counter = Object.assign(
    {},
    createTokenCounter({
      measurementRef: 'rr5:codepoints:v1',
      inputContract: TEXT_TOKEN_INPUT_CONTRACT,
      measure: ({ text }) =>
        Promise.resolve({ tokens: Array.from(text).length, accuracy: 'exact' }),
    }),
    { close }
  );
  const scope = ownScope(
    createResourceScope(recipe.blueprint, {
      bindings: [borrowResource(recipe.tokens.counter.request('default'), counter)],
    })
  );
  const bundle = await bindMemoryFactories(recipe, scope, locations).context();
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', config: { maxContextTokens: 1 } },
  });
  await expect(
    bundle.workflows.apply.run({
      input: {
        memoryId: 'a',
        requestId: 'apply',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'ab' }],
      },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', commit: { status: 'not-committed' } });
  expect(
    (await bundle.workflows.readContext.run({ input: { memoryId: 'a' } }))?.measurement
      .measurementRef
  ).toBe('rr5:codepoints:v1');
  await scope.close();
  expect(close).not.toHaveBeenCalled();
});

it('replaces a Provider and complete Bundle graph through composition, leaving Core and Memory unchanged', async () => {
  const locations = await paths();
  const original = modelFixture();
  const alternate = modelFixture();
  let constructed = 0;
  const base = createMemoryEditDefinition();
  const graph: ReturnType<typeof createMemoryEditDefinition> = {
    ...base,
    stepDefinitions: {
      ...base.stepDefinitions,
      runModelOperation: {
        ...base.stepDefinitions.runModelOperation,
        step: async (context) => {
          await context.runStep('prepareInput');
          context.result = { status: 'skipped', reason: 'consumer-defined graph' };
        },
      },
    },
  };
  const definition = defineMemoryRecipe(original.recipes, {
    contextBundle: (resources) => {
      constructed++;
      return customContextBundle(resources, graph);
    },
  });
  const replacement = defineResourceProvider({
    token: definition.tokens.completion,
    dependencies: {},
    describe: describeResource,
    create: () => alternate.recipes.completion(),
  });
  const recipe = compileMemoryRecipe({
    ...definition,
    providers: { ...definition.providers, completion: replacement },
  });
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const bundle = await bindMemoryFactories(recipe, scope, locations).context();
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  expect(
    await bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'not executed' },
    })
  ).toMatchObject({ status: 'skipped' });
  await bundle.workflows.observe.run({
    input: { memoryId: 'a', requestId: 'observe', context: [] },
  });
  expect(constructed).toBe(1);
  expect(original.created.completion).toBe(0);
  expect(alternate.created.completion).toBe(1);
  expect(alternate.completions).toHaveLength(1);
  expect((await bundle.workflows.readContext.run({ input: { memoryId: 'a' } }))?.text).toBe(
    'observed'
  );
});

it('retains healthy dependencies after a real Bundle construction failure, retrying only explicitly', async () => {
  const locations = await paths();
  const models = modelFixture();
  let attempts = 0;
  const recipe = compileMemoryRecipe(
    defineMemoryRecipe(models.recipes, {
      contextBundle: (resources) => {
        if (++attempts === 1) throw new Error('Rejected Bundle construction');
        return customContextBundle(resources);
      },
    })
  );
  const scope = ownScope(createResourceScope(recipe.blueprint));
  const factory = bindMemoryFactories(recipe, scope, locations);
  await expect(factory.context()).rejects.toMatchObject({ code: 'RESOURCE_INITIALIZATION_FAILED' });
  expect(models.created.completion).toBe(1);
  expect(models.released.completion).toBe(0);
  const bundle = await factory.context();
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  expect(attempts).toBe(2);
  expect(models.created.completion).toBe(1);
});

it('does not extend a real store lease by injecting it into another Scope and retaining the Bundle', async () => {
  const locations = await paths();
  const models = modelFixture();
  const recipe = compileMemoryRecipe(defineMemoryRecipe(models.recipes));
  const owner = ownScope(createResourceScope(recipe.blueprint));
  const store = await owner.registry.resolve(recipe.tokens.contextStore.request(locations.context));
  const borrower = ownScope(
    createResourceScope(recipe.blueprint, {
      bindings: [borrowResource(recipe.tokens.contextStore.request(locations.context), store)],
    })
  );
  const bundle = await bindMemoryFactories(recipe, borrower, locations).context();
  await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await owner.close(); // Deliberate external-owner misuse, not an automatic ownership transfer.
  await expect(
    bundle.workflows.readContext.run({ input: { memoryId: 'a' } })
  ).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  await borrower.close();
  expect(models.released.completion).toBe(1);
});
