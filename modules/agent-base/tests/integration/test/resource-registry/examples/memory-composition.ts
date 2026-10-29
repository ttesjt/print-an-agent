import {
  bindResourceScope,
  compileResourceBlueprint,
  defineResourceProvider,
  resourceDependency,
  ResourceCleanupError,
  type ResourceAcquisition,
  type ResourceBlueprint,
  type ResourceScope,
} from '@ta-agent/base-composition/resource-registry';
import {
  ContextMemoryError,
  createCompletionMemoryPlanner,
  createContextMemoryBundle,
  createModelMemoryResources,
  MemoryMeter,
  type ModelMemoryResources,
} from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import {
  createCodepointChunker,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  COSINE_METRIC_REF,
  RetrievalMemoryError,
} from '@ta-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@ta-agent/retrieval-memory-sqlite';
import type {
  CompletionCapability,
  TextEmbeddingCapability,
} from '@ta-agent/model-invocation-core';
import { createTiktokenTextCounter } from '@ta-agent/model-invocation-token-counters';
import { memoryTokens, describeResource, type ContextBundle } from './tokens.js';

export interface ModelRecipes {
  readonly completion: (
    signal: AbortSignal
  ) =>
    | ResourceAcquisition<CompletionCapability>
    | Promise<ResourceAcquisition<CompletionCapability>>;
  readonly embedding: (
    signal: AbortSignal
  ) =>
    | ResourceAcquisition<TextEmbeddingCapability>
    | Promise<ResourceAcquisition<TextEmbeddingCapability>>;
}

/** Maps known adapter initialization cleanup failures at the composition boundary, not in Core. */
async function acquire<T>(factory: () => ResourceAcquisition<T> | Promise<ResourceAcquisition<T>>) {
  try {
    return await factory();
  } catch (cause) {
    if (
      (cause instanceof ContextMemoryError || cause instanceof RetrievalMemoryError) &&
      cause.code === 'CLEANUP_FAILED'
    )
      throw new ResourceCleanupError({ primary: cause, failures: [cause] });
    throw cause;
  }
}

/** Recipe only: no model call, database opening or bundle construction until Scope.resolve. */
export function defineMemoryRecipe(
  models: ModelRecipes,
  options: {
    readonly contextBundle?: (resources: ModelMemoryResources) => ContextBundle;
  } = {}
) {
  const tokens = memoryTokens();
  const completion = models.completion;
  const embedding = models.embedding;
  const contextBundle =
    options.contextBundle ??
    ((resources: ModelMemoryResources) => createContextMemoryBundle({ resources }));
  const providers = {
    contextStore: defineResourceProvider({
      token: tokens.contextStore,
      dependencies: {},
      describe: describeResource,
      externalBinding: 'borrowed',
      create: ({ binding }) =>
        acquire(() => {
          const value = new SqliteMemoryStore({ path: binding });
          return { value, release: () => value.close() };
        }),
    }),
    retrievalBackend: defineResourceProvider({
      token: tokens.retrievalBackend,
      dependencies: {},
      describe: describeResource,
      externalBinding: 'borrowed',
      create: ({ binding }) =>
        acquire(async () => {
          const value = await openSqliteRetrievalBackend({ path: binding });
          return { value, release: () => value.close() };
        }),
    }),
    counter: defineResourceProvider({
      token: tokens.counter,
      dependencies: {},
      describe: describeResource,
      externalBinding: 'borrowed',
      create: () => ({ value: createTiktokenTextCounter({ encoding: 'o200k_base' }) }),
    }),
    completion: defineResourceProvider({
      token: tokens.completion,
      dependencies: {},
      describe: describeResource,
      externalBinding: 'borrowed',
      create: ({ signal }) => completion(signal),
    }),
    embedding: defineResourceProvider({
      token: tokens.embedding,
      dependencies: {},
      describe: describeResource,
      externalBinding: 'borrowed',
      create: ({ signal }) => embedding(signal),
    }),
    chunker: defineResourceProvider({
      token: tokens.chunker,
      dependencies: {},
      describe: describeResource,
      create: () => ({ value: createCodepointChunker() }),
    }),
    context: defineResourceProvider({
      token: tokens.context,
      describe: describeResource,
      dependencies: {
        store: resourceDependency(tokens.contextStore, (path: string) => path),
        counter: resourceDependency(tokens.counter, () => 'default'),
        completion: resourceDependency(tokens.completion, () => 'default'),
      },
      create: ({ dependencies: { store, counter, completion } }) => ({
        value: contextBundle(
          createModelMemoryResources({
            store,
            meter: new MemoryMeter({ counter }),
            defaults: { measurementRef: counter.descriptor.measurementRef },
            planner: createCompletionMemoryPlanner({ completion }),
          })
        ),
      }),
    }),
    retrieval: defineResourceProvider({
      token: tokens.retrieval,
      describe: describeResource,
      dependencies: {
        backend: resourceDependency(tokens.retrievalBackend, (path: string) => path),
        counter: resourceDependency(tokens.counter, () => 'default'),
        embedding: resourceDependency(tokens.embedding, () => 'default'),
        chunker: resourceDependency(tokens.chunker, () => 'default'),
      },
      create: ({ dependencies: { backend, counter, embedding, chunker } }) => ({
        value: createRetrievalMemoryBundle({
          resources: createRetrievalWorkflowResources(
            {
              backend,
              embeddings: {
                resolve: (ref) => {
                  if (ref !== embedding.descriptor.representationRef)
                    throw new Error('Embedding not configured.');
                  return embedding;
                },
              },
              chunkers: {
                resolve: (ref) => {
                  if (ref !== chunker.ref) throw new Error('Chunker not configured.');
                  return chunker;
                },
              },
            },
            { context: { counter } }
          ),
        }),
      }),
    }),
  };
  return Object.freeze({ tokens, providers: Object.freeze(providers) });
}
export type MemoryRecipe = ReturnType<typeof defineMemoryRecipe>;
export type CompiledMemoryRecipe = Pick<MemoryRecipe, 'tokens'> & {
  readonly blueprint: ResourceBlueprint;
};
export function compileMemoryRecipe(recipe: MemoryRecipe): CompiledMemoryRecipe {
  return Object.freeze({
    tokens: recipe.tokens,
    blueprint: compileResourceBlueprint(Object.values(recipe.providers)),
  });
}

/** Composition factories capture the Registry; Memory/Workflow code never receives it. */
export function bindMemoryFactories(
  recipe: CompiledMemoryRecipe,
  scope: ResourceScope,
  paths: { readonly context: string; readonly retrieval: string }
) {
  const registry = bindResourceScope(recipe.blueprint, scope);
  const { context, retrieval } = paths;
  return Object.freeze({
    context: () => registry.resolve(recipe.tokens.context.request(context)),
    retrieval: () => registry.resolve(recipe.tokens.retrieval.request(retrieval)),
    index: async () => {
      const embedding = await registry.resolve(recipe.tokens.embedding.request('default'));
      const chunker = await registry.resolve(recipe.tokens.chunker.request('default'));
      return {
        embeddingRef: embedding.descriptor.representationRef,
        chunkerRef: chunker.ref,
        metricRef: COSINE_METRIC_REF,
      };
    },
  });
}
