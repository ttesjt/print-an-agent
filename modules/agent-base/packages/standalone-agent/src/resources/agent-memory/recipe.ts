import { validateMemoryIdentifier } from '@print-an-agent/base-composition';
import {
  ResourceCleanupError,
  ResourceToken,
  compileResourceBlueprint,
  defineResourceProvider,
  type ResourceAcquisition,
} from '@print-an-agent/base-composition/resource-registry';
import { ContextMemoryError, type MemoryStore } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import { createTiktokenTextCounter } from '@print-an-agent/model-invocation-token-counters';
import {
  RetrievalMemoryError,
  createCodepointChunker,
  type RetrievalBackend,
  type RetrievalChunker,
} from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';
import type {
  AgentMemoryStorageBinding,
  MemoryTextCounter,
  StandaloneMemoryManagementOptions,
} from './contracts.js';

export const DEFAULT_MEMORY_MEASUREMENT_REF = createTiktokenTextCounter({ encoding: 'o200k_base' })
  .descriptor.measurementRef;

const describe = (key: string) => ({ key, descriptor: key });

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    methods.every((name) => name in value && typeof Reflect.get(value, name) === 'function')
  );
}

async function acquire<T>(
  factory: () => ResourceAcquisition<T> | Promise<ResourceAcquisition<T>>
): Promise<ResourceAcquisition<T>> {
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

function defaultCounter(ref: string): ResourceAcquisition<MemoryTextCounter> {
  if (ref !== DEFAULT_MEMORY_MEASUREMENT_REF)
    throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'Requested counter is not installed.');
  return { value: createTiktokenTextCounter({ encoding: 'o200k_base' }) };
}

/** Compile only; no adapter, tokenizer vocabulary, worker or model initialization. */
export function memoryManagementRecipe(
  options: StandaloneMemoryManagementOptions,
  agentId: string,
  storage: AgentMemoryStorageBinding
) {
  const store = new ResourceToken('standalone.context-memory.store', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is MemoryStore => hasMethods(v, ['read', 'getReceipt', 'commit']),
  });
  const backend = new ResourceToken('standalone.retrieval-memory.backend', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is RetrievalBackend =>
      hasMethods(v, ['inspect', 'get', 'list', 'search', 'getReceipt', 'publish']),
  });
  const counter = new ResourceToken('standalone.context-memory.counter', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is MemoryTextCounter => hasMethods(v, ['measure']),
  });
  const retrievalCounter = new ResourceToken('standalone.retrieval-memory.counter', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is MemoryTextCounter => hasMethods(v, ['measure']),
  });
  const embedding = new ResourceToken('standalone.retrieval-memory.embedding', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is TextEmbeddingCapability => hasMethods(v, ['embed']),
  });
  const chunker = new ResourceToken('standalone.retrieval-memory.chunker', {
    parseBinding: validateMemoryIdentifier,
    isValue: (v): v is RetrievalChunker => hasMethods(v, ['chunk']),
  });
  const providers = [
    defineResourceProvider({
      token: store,
      describe,
      dependencies: {},
      create: ({ signal }) =>
        acquire(() => {
          if (options.context?.acquireStore)
            return options.context.acquireStore({ agentId, path: storage.contextPath, signal });
          const value = new SqliteMemoryStore({ path: storage.contextPath });
          return { value, release: () => value.close() };
        }),
    }),
    defineResourceProvider({
      token: backend,
      describe,
      dependencies: {},
      create: ({ signal }) =>
        acquire(async () => {
          if (options.retrieval?.acquireBackend)
            return options.retrieval.acquireBackend({
              agentId,
              path: storage.retrievalPath,
              signal,
            });
          const value = await openSqliteRetrievalBackend({ path: storage.retrievalPath });
          return { value, release: () => value.close() };
        }),
    }),
    defineResourceProvider({
      token: counter,
      describe,
      dependencies: {},
      create: ({ binding, signal }) =>
        acquire(() =>
          options.context?.acquireCounter === undefined
            ? defaultCounter(binding)
            : options.context.acquireCounter(binding, signal)
        ),
    }),
    defineResourceProvider({
      token: retrievalCounter,
      describe,
      dependencies: {},
      create: ({ binding, signal }) =>
        acquire(() =>
          options.retrieval?.acquireCounter === undefined
            ? defaultCounter(binding)
            : options.retrieval.acquireCounter(binding, signal)
        ),
    }),
    defineResourceProvider({
      token: embedding,
      describe,
      dependencies: {},
      create: ({ binding, signal }) =>
        acquire(() => {
          if (!options.retrieval?.acquireEmbedding)
            throw new RetrievalMemoryError(
              'UNSUPPORTED_CAPABILITY',
              'Embedding capability is not installed.'
            );
          return options.retrieval.acquireEmbedding(binding, signal);
        }),
    }),
    defineResourceProvider({
      token: chunker,
      describe,
      dependencies: {},
      create: ({ binding, signal }) =>
        acquire(() => {
          if (options.retrieval?.acquireChunker)
            return options.retrieval.acquireChunker(binding, signal);
          const value = createCodepointChunker();
          if (binding !== value.ref)
            throw new RetrievalMemoryError(
              'UNSUPPORTED_CAPABILITY',
              'Requested chunker is not installed.'
            );
          return { value };
        }),
    }),
  ];
  return {
    blueprint: compileResourceBlueprint(providers),
    store,
    backend,
    counter,
    retrievalCounter,
    embedding,
    chunker,
  };
}

export type MemoryManagementRecipe = ReturnType<typeof memoryManagementRecipe>;
