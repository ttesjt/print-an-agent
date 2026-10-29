import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createAgentManagementService } from '@ta-agent/base-composition';
import { parseAgentId } from '@ta-agent/base-identity';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  createTextEmbedder,
} from '@ta-agent/model-invocation-core';
import { ContextMemoryError } from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import {
  createCodepointChunker,
  COSINE_METRIC_REF,
  RetrievalMemoryError,
} from '@ta-agent/retrieval-memory';
import {
  createStandaloneDirectorySetup,
  createSharedSqliteStandaloneSetup,
  createStandaloneMemorySetup,
  type MemoryManagedStandaloneDefinition,
  type StandaloneSetup,
  type StandaloneMemoryManagementOptions,
} from '../../src/index.js';
import { resourceProfileConfig } from '../support/resource-profile.js';

const runtime = {
  readEnvironmentVariable: () => {
    throw new Error('Management must not request credentials.');
  },
};
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'base-memory-management-'));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  return path;
}
function counter() {
  return createTokenCounter({
    measurementRef: 'test:chars',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
  });
}
const contextOptions = () => ({
  defaults: { measurementRef: 'test:chars' },
  acquireCounter: () => ({ value: counter() }),
});

function profileCases<N>(
  name: string,
  factory: (
    memory?: StandaloneMemoryManagementOptions
  ) => Promise<StandaloneSetup<N> & { definition: MemoryManagedStandaloneDefinition<N> }>
) {
  it(`${name}: independent optional capabilities, real workflows and shared authority without runtime`, async () => {
    const acquireCounter = vi.fn(contextOptions().acquireCounter);
    const setup = await factory({
      storageNamespaceId: 'tests',
      context: { ...contextOptions(), acquireCounter },
      retrieval: {},
    });
    onTestFinished(() => setup.close({ mode: 'abort' }));
    const agents = createAgentManagementService(setup.definition);
    for (const id of ['a', 'b'])
      await agents.create({ identity: { id }, config: resourceProfileConfig() });
    const a = (await setup.definition.namespace.port.resolve(parseAgentId('a')))!;
    const b = (await setup.definition.namespace.port.resolve(parseAgentId('b')))!;
    const context = setup.definition.contextMemoryManagement!.resolve;
    await expect(
      (await context.inspect({ namespace: a, input: { memoryId: 'notes' } })).invoke()
    ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
    expect(acquireCounter).not.toHaveBeenCalled();
    const input = { memoryId: 'notes', requestId: 'create', items: [{ content: 'hello' }] };
    const created = await (await context.create({ namespace: a, input })).invoke();
    expect(created).toMatchObject({ status: 'committed', receipt: { revision: 1 } });
    expect(acquireCounter).toHaveBeenCalledOnce();
    expect(
      await (await context.readContext({ namespace: a, input: { memoryId: 'notes' } })).invoke()
    ).toMatchObject({ text: 'hello' });
    expect(acquireCounter).toHaveBeenCalledOnce();
    await expect(
      (await context.inspect({ namespace: b, input: { memoryId: 'notes' } })).invoke()
    ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
    await agents.updateConfig({
      agentId: a.agentId,
      expectedRevision: 1,
      config: resourceProfileConfig('changed'),
    });
    await agents.disable({ agentId: a.agentId, expectedIdentityRevision: 1 });
    expect(
      await (await context.inspect({ namespace: a, input: { memoryId: 'notes' } })).invoke()
    ).toMatchObject({ revision: 1 });
    expect(
      await (await context.replay({ namespace: a, input: { operation: 'create', input } })).invoke()
    ).toEqual(created.status === 'skipped' ? undefined : created.receipt);
    await expect(
      (
        await setup.definition.retrievalMemoryManagement!.resolve.list({
          namespace: a,
          input: { memoryId: 'knowledge' },
        })
      ).invoke()
    ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
  });
  it(`${name}: disabled Memory is absent and setup close fences its resolver`, async () => {
    const plain = await factory();
    expect(plain.definition.contextMemoryManagement).toBeUndefined();
    expect(plain.definition.retrievalMemoryManagement).toBeUndefined();
    await plain.close();
    const setup = await factory({ storageNamespaceId: 'tests', context: {} });
    const agents = createAgentManagementService(setup.definition);
    await agents.create({ identity: { id: 'closed' }, config: resourceProfileConfig() });
    const namespace = (await setup.definition.namespace.port.resolve(parseAgentId('closed')))!;
    await setup.close();
    await expect(
      setup.definition.contextMemoryManagement!.resolve.inspect({
        namespace,
        input: { memoryId: 'm' },
      })
    ).rejects.toThrow();
    await setup.close();
  });
}
profileCases('ephemeral', (memory) =>
  Promise.resolve(createStandaloneMemorySetup(runtime, memory))
);
profileCases('directory', async (memory) =>
  createStandaloneDirectorySetup({ ...runtime, rootDirectory: await directory() }, memory)
);
profileCases('shared SQLite', async (memory) =>
  createSharedSqliteStandaloneSetup(
    { ...runtime, databasePath: join(await directory(), 'agents.sqlite') },
    memory
  )
);

it('setup construction acquires no Memory resources, and failed staged allocations cannot be reused by stale handles', async () => {
  const root = await directory();
  const durable = createStandaloneDirectorySetup(
    { ...runtime, rootDirectory: join(root, 'not-created') },
    { storageNamespaceId: 'stable', context: {}, retrieval: {} }
  );
  // The existing Directory profile prepares its root; enabling Memory adds no DB or worker.
  expect(await readdir(join(root, 'not-created'))).toEqual([]);
  await durable.close();
  const setup = createStandaloneMemorySetup(runtime, { storageNamespaceId: 'stable', context: {} });
  onTestFinished(() => setup.close());
  const port = setup.definition.namespace.port;
  const first = await port.stage(parseAgentId('retry'));
  await port.abort(first);
  const next = await port.stage(parseAgentId('retry'));
  const published = await port.publish(next);
  const resolver = setup.definition.contextMemoryManagement!.resolve;
  await expect(
    resolver.inspect({ namespace: { ...first, phase: 'published' }, input: { memoryId: 'm' } })
  ).rejects.toThrow();
  await expect(
    (await resolver.inspect({ namespace: published, input: { memoryId: 'm' } })).invoke()
  ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
  await expect(port.abort(next)).rejects.toThrow();
  await expect(
    (await resolver.inspect({ namespace: published, input: { memoryId: 'm' } })).invoke()
  ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
});

it('durable reopen recovers native receipts before unavailable measurement or embedding acquisition', async () => {
  const databasePath = join(await directory(), 'agents.sqlite');
  const embedding = createTextEmbedder({
    representation: {
      modelRef: 'fixture',
      dimensions: 2,
      preprocessingRef: 'raw',
      documentRecipeRef: 'same',
      queryRecipeRef: 'same',
      outputTransformRef: 'raw',
    },
    limits: { maxBatchSize: 10, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed: ({ inputs }) => Promise.resolve(inputs.map(({ id }) => ({ id, vector: [1, 0] }))),
  });
  const chunker = createCodepointChunker();
  const first = createSharedSqliteStandaloneSetup(
    { ...runtime, databasePath },
    {
      storageNamespaceId: 'stable',
      context: contextOptions(),
      retrieval: { acquireEmbedding: () => ({ value: embedding }) },
    }
  );
  await createAgentManagementService(first.definition).create({
    identity: { id: 'a' },
    config: resourceProfileConfig(),
  });
  const namespace = (await first.definition.namespace.port.resolve(parseAgentId('a')))!;
  const input = { memoryId: 'notes', requestId: 'create' };
  await (
    await first.definition.contextMemoryManagement!.resolve.create({ namespace, input })
  ).invoke();
  const retrieval = first.definition.retrievalMemoryManagement!.resolve;
  await (
    await retrieval.create({
      namespace,
      input: {
        memoryId: 'knowledge',
        requestId: 'create',
        index: {
          embeddingRef: embedding.descriptor.representationRef,
          chunkerRef: chunker.ref,
          metricRef: COSINE_METRIC_REF,
        },
      },
    })
  ).invoke();
  const ingest = { memoryId: 'knowledge', requestId: 'ingest', content: 'hello' };
  const added = await (await retrieval.ingest({ namespace, input: ingest })).invoke();
  if (added.status === 'skipped') throw new Error('Unexpected skip');
  await first.close();
  const unavailable = vi.fn(() => {
    throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'offline');
  });
  const second = createSharedSqliteStandaloneSetup(
    { ...runtime, databasePath },
    { storageNamespaceId: 'stable', context: { acquireCounter: unavailable }, retrieval: {} }
  );
  onTestFinished(() => second.close());
  const current = (await second.definition.namespace.port.resolve(parseAgentId('a')))!;
  expect(
    await (
      await second.definition.contextMemoryManagement!.resolve.replay({
        namespace: current,
        input: { operation: 'create', input },
      })
    ).invoke()
  ).toMatchObject({ revision: 1 });
  expect(unavailable).not.toHaveBeenCalled();
  const r = second.definition.retrievalMemoryManagement!.resolve;
  expect(
    await (
      await r.replay({ namespace: current, input: { operation: 'ingest', input: ingest } })
    ).invoke()
  ).toEqual(added.receipt);
  expect(
    await (
      await r.get({
        namespace: current,
        input: { memoryId: 'knowledge', entryId: added.receipt.entryId! },
      })
    ).invoke()
  ).toMatchObject({ status: 'completed', value: { content: 'hello' } });
  await (
    await r.remove({
      namespace: current,
      input: {
        memoryId: 'knowledge',
        requestId: 'remove',
        entryId: added.receipt.entryId!,
        expectedRevision: 1,
      },
    })
  ).invoke();
});

it('cancels only an initialization waiter; setup still owns and joins the acquisition', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = vi.fn(() => store.close());
  const acquireStore = vi.fn(async () => {
    await gate;
    return { value: store, release: closed };
  });
  const setup = createStandaloneMemorySetup(runtime, {
    storageNamespaceId: 'stable',
    context: { acquireStore },
  });
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'a' },
    config: resourceProfileConfig(),
  });
  const namespace = (await setup.definition.namespace.port.resolve(parseAgentId('a')))!;
  const abort = new AbortController();
  const request = setup.definition.contextMemoryManagement!.resolve.inspect(
    { namespace, input: { memoryId: 'm' } },
    { signal: abort.signal }
  );
  await vi.waitFor(() => expect(acquireStore).toHaveBeenCalledOnce());
  abort.abort();
  await expect(request).rejects.toThrow();
  let drained = false;
  const closing = setup.close().then(() => {
    drained = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(drained).toBe(false);
  release();
  await closing;
  expect(closed).toHaveBeenCalledOnce();
  await setup.close();
  expect(closed).toHaveBeenCalledOnce();
});

it.each(['release', 'initialization'] as const)(
  'retains %s cleanup failures for setup close',
  async (kind) => {
    const store = new SqliteMemoryStore({ path: ':memory:' });
    onTestFinished(() => store.close());
    const setup = createStandaloneMemorySetup(runtime, {
      storageNamespaceId: 'stable',
      context: {
        acquireStore: () => {
          if (kind === 'initialization')
            throw new ContextMemoryError('CLEANUP_FAILED', 'initialization unwind failed');
          return {
            value: store,
            release: () => {
              throw new Error('release failed');
            },
          };
        },
      },
    });
    await createAgentManagementService(setup.definition).create({
      identity: { id: 'a' },
      config: resourceProfileConfig(),
    });
    const namespace = (await setup.definition.namespace.port.resolve(parseAgentId('a')))!;
    try {
      await (
        await setup.definition.contextMemoryManagement!.resolve.inspect({
          namespace,
          input: { memoryId: 'm' },
        })
      ).invoke();
    } catch {
      /* both paths intentionally fail */
    }
    await expect(setup.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    await expect(setup.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
  }
);

it('does not close a borrowed root and maps acquisition unwind failures from Retrieval', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  onTestFinished(() => store.close());
  const setup = createStandaloneMemorySetup(runtime, {
    storageNamespaceId: 'stable',
    context: { acquireStore: () => ({ value: store }) },
    retrieval: {
      acquireBackend: () => {
        throw new RetrievalMemoryError('CLEANUP_FAILED', 'worker unwind failed');
      },
    },
  });
  await createAgentManagementService(setup.definition).create({
    identity: { id: 'a' },
    config: resourceProfileConfig(),
  });
  const namespace = (await setup.definition.namespace.port.resolve(parseAgentId('a')))!;
  await expect(
    (
      await setup.definition.contextMemoryManagement!.resolve.inspect({
        namespace,
        input: { memoryId: 'm' },
      })
    ).invoke()
  ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
  await expect(
    setup.definition.retrievalMemoryManagement!.resolve.inspect({
      namespace,
      input: { memoryId: 'm' },
    })
  ).rejects.toThrow();
  await expect(setup.close()).rejects.toThrow();
  expect(await store.read('m')).toBeUndefined();
});
