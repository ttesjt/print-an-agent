// Production-like Node process: DOM emulation must not replace worker/SQLite globals.
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createCodepointChunker, COSINE_METRIC_REF } from '@ta-agent/retrieval-memory';
import {
  createTextEmbedder,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@ta-agent/model-invocation-core';
import type * as Backend from '../../src/node/agent-base/backend.js';
import type * as Server from '../../src/node/transport/http-server.js';
import type * as Collections from '../../src/node/collections/directory-host.js';
import type { WebMemoryOptions } from '../../src/node/memory/options.js';

const backend: unknown = await import(
  resolve(import.meta.dirname, '../../dist/server/node/agent-base/backend.js')
);
const server: unknown = await import(
  resolve(import.meta.dirname, '../../dist/server/node/transport/http-server.js')
);
function isBackend(value: unknown): value is Pick<typeof Backend, 'createAgentBaseWebPorts'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createAgentBaseWebPorts' in value &&
    typeof value.createAgentBaseWebPorts === 'function'
  );
}
function isServer(value: unknown): value is Pick<typeof Server, 'startLocalAgentWebServer'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'startLocalAgentWebServer' in value &&
    typeof value.startLocalAgentWebServer === 'function'
  );
}
if (!isBackend(backend) || !isServer(server))
  throw new Error('Build Agent Web before running fixture');
const embedding = createTextEmbedder({
  representation: {
    modelRef: 'web-test',
    dimensions: 2,
    preprocessingRef: 'raw',
    documentRecipeRef: 'same',
    queryRecipeRef: 'same',
    outputTransformRef: 'raw',
  },
  limits: { maxBatchSize: 64, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
  embed: ({ inputs }) =>
    Promise.resolve(
      inputs.map(({ id, text }) => ({ id, vector: text.includes('dog') ? [0, 1] : [1, 0] }))
    ),
});
const counter = () => ({
  value: createTokenCounter({
    measurementRef: 'chars',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
  }),
});
const bindings =
  process.env.MEMORY_MULTI === '1'
    ? [
        { memoryId: 'one', label: 'One' },
        { memoryId: 'two', label: 'Two' },
      ]
    : undefined;
const memory: WebMemoryOptions = {
  provisioning: {
    storageNamespaceId: 'web-tests',
    context: { defaults: { measurementRef: 'chars' }, acquireCounter: counter },
    ...(process.env.MEMORY_CONTEXT_ONLY === '1'
      ? {}
      : {
          retrieval: {
            acquireEmbedding: () => ({ value: embedding }),
            measurementRef: 'chars',
            acquireCounter: counter,
          },
        }),
  },
  ...(bindings ? { contextBindings: bindings } : {}),
  embeddings: [
    {
      embeddingRef: embedding.descriptor.representationRef,
      chunkerRef: createCodepointChunker().ref,
      metricRef: COSINE_METRIC_REF,
      label: 'Fixture embedding',
    },
  ],
};
const ports = backend.createAgentBaseWebPorts({ persistence: { kind: 'memory' }, memory });
const collectionModule: unknown = await import(
  resolve(import.meta.dirname, '../../dist/server/node/collections/directory-host.js')
);
function isCollections(
  value: unknown
): value is Pick<typeof Collections, 'createDirectoryCollectionHost'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createDirectoryCollectionHost' in value &&
    typeof value.createDirectoryCollectionHost === 'function'
  );
}
if (!isCollections(collectionModule))
  throw new Error('Build Collection host before running fixture');
const root = process.send ? undefined : await mkdtemp(resolve(tmpdir(), 'memory-browser-'));
const collections =
  root === undefined
    ? undefined
    : await collectionModule.createDirectoryCollectionHost({ memory, initialRoot: root });
const host = await server.startLocalAgentWebServer({
  ...(collections ? { collections } : { ports }),
  closeResources: async () => {
    await ports.close();
    await collections?.close();
    if (root) await rm(root, { recursive: true });
  },
  publicDirectory: resolve(import.meta.dirname, '../../dist/public'),
});
process.send?.({ origin: host.origin });
if (!process.send) console.info(host.origin);
const close = () => {
  void host.close().then(() => {
    if (process.connected) process.disconnect();
  });
};
process.once('message', close);
process.once('SIGINT', close);
process.once('SIGTERM', close);
