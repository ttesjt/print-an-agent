import { expect, it } from 'vitest';
import { createRetrievalMemoryManagementService } from '@print-an-agent/base-composition';
import {
  assertNotAborted,
  createRetrievalIngestDefinition,
  createRetrievalReceiptDefinition,
  RetrievalMemoryError,
  mutationDigest,
  parseMutation,
} from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';
import { retrievalFixture, target, receipt } from '../support/retrieval-management.js';
import { directRetrievalMemory } from '../support/direct-retrieval-memory.js';

it.each(['before', 'after'] as const)(
  'keeps cleanup and commit facts when cancelled %s publication',
  async (when) => {
    const abort = new AbortController();
    const { service } = await retrievalFixture({
      workflows: {
        ingest: createRetrievalIngestDefinition({
          executeStep: async (execution) => {
            if (when === 'before' && execution.stepName === 'publish') {
              abort.abort();
              assertNotAborted(execution.context.signal);
            }
            await execution.step(execution.context);
            if (when === 'after' && execution.stepName === 'publish') {
              abort.abort();
              assertNotAborted(execution.context.signal);
            }
          },
          lifecycle: {
            onFinally: () => {
              throw new RetrievalMemoryError('CLEANUP_FAILED', 'private SQL /secret.db');
            },
          },
        }),
      },
    });
    const error: unknown = await service
      .ingest({ ...target, requestId: 'ingest', content: 'cat' }, { signal: abort.signal })
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: 'MEMORY_OPERATION_FAILED',
      failure: {
        code: 'CLEANUP_FAILED',
        commit: { status: when === 'after' ? 'committed' : 'not-committed' },
      },
    });
    expect(JSON.stringify(error)).not.toContain('secret.db');
    expect((await service.list(target)).value).toMatchObject({
      value: { entries: when === 'after' ? [expect.any(Object)] : [] },
    });
  }
);

it('preserves a receipt even when query Executor post-processing fails', async () => {
  const { service } = await retrievalFixture({
    workflows: {
      getReceipt: createRetrievalReceiptDefinition({
        executeStep: async (execution) => {
          await execution.step(execution.context);
          if (execution.stepName === 'executeQuery') throw new Error('private receipt cleanup');
        },
      }),
    },
  });
  await expect(service.getReceipt({ ...target, requestId: 'create' })).rejects.toMatchObject({
    failure: {
      code: 'CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { requestId: 'create' } },
    },
  });
});

it.each(['foreign-first', 'current-first'] as const)(
  'filters aggregate receipt evidence before ranking (%s)',
  async (order) => {
    const { service, definition } = await retrievalFixture();
    const factories = definition.retrievalMemoryManagement.resolve;
    const wrapped = createRetrievalMemoryManagementService({
      ...definition,
      retrievalMemoryManagement: {
        resolve: {
          ...factories,
          ingest: async (r, options) => {
            const invocation = await factories.ingest(r, options);
            return {
              ...invocation,
              invoke: async (signal) => {
                const current = receipt(await invocation.invoke(signal));
                const foreign = {
                  ...current,
                  inputDigest: mutationDigest(
                    parseMutation('ingest', {
                      ...r.input,
                      memoryId: current.memoryId,
                      content: 'different',
                    })
                  ),
                };
                const own = new RetrievalMemoryError('CLEANUP_FAILED', 'current', {
                  commit: { status: 'committed', receipt: current },
                });
                const other = new RetrievalMemoryError('CLEANUP_FAILED', 'foreign', {
                  commit: { status: 'committed', receipt: foreign },
                  cause: own,
                });
                throw new AggregateError(order === 'foreign-first' ? [other, own] : [own, other]);
              },
            };
          },
        },
      },
    });
    const input = { ...target, requestId: 'ingest', content: 'cat' };
    await expect(wrapped.ingest(input)).rejects.toMatchObject({
      failure: { commit: { status: 'committed', receipt: { requestId: 'ingest' } } },
    });
    const result = await wrapped.ingest(input);
    expect(result.value).toMatchObject({ receipt: { sequence: 1 } });
    expect((await service.list(target)).value).toMatchObject({
      value: { entries: [expect.any(Object)] },
    });
  }
);

it('recovers unknown delivery without recomputing embeddings and supports a non-Registry Profile', async () => {
  const { service, definition, setup, index, embedding, chunker } = await retrievalFixture();
  const backend = await openSqliteRetrievalBackend({ path: ':memory:' });
  try {
    const direct = directRetrievalMemory(setup.definition.namespace.port, {
      backend,
      embeddings: { resolve: () => embedding },
      chunkers: { resolve: () => chunker },
    });
    const other = createRetrievalMemoryManagementService(direct);
    await other.create({ ...target, requestId: 'create', index });
    await other.ingest({ ...target, requestId: 'direct', content: 'cat' });
    expect((await other.list(target)).value).toMatchObject({
      value: { entries: [expect.any(Object)] },
    });
  } finally {
    await backend.close();
  }
  const factories = definition.retrievalMemoryManagement.resolve;
  const lost = createRetrievalMemoryManagementService({
    ...definition,
    retrievalMemoryManagement: {
      resolve: {
        ...factories,
        ingest: async (r, options) => {
          const invocation = await factories.ingest(r, options);
          return {
            ...invocation,
            invoke: async (signal) => {
              await invocation.invoke(signal);
              throw new Error('delivery lost');
            },
          };
        },
      },
    },
  });
  const input = { ...target, requestId: 'lost', content: 'dog' };
  await expect(lost.ingest(input)).rejects.toMatchObject({
    failure: { commit: { status: 'unknown' } },
  });
  expect((await service.getReceipt({ ...target, requestId: 'lost' })).value).toMatchObject({
    value: { requestId: 'lost' },
  });
  expect((await lost.ingest(input)).value).toMatchObject({ receipt: { requestId: 'lost' } });
});

it('checks cancellation after namespace resolution before dispatch, and rejects foreign result targets', async () => {
  const { service, definition } = await retrievalFixture();
  const abort = new AbortController();
  const cancelled = createRetrievalMemoryManagementService({
    ...definition,
    namespace: {
      port: {
        ...definition.namespace.port,
        resolve: async (id) => {
          const result = await definition.namespace.port.resolve(id);
          abort.abort();
          return result;
        },
      },
    },
  });
  await expect(
    cancelled.ingest(
      { ...target, requestId: 'cancelled', content: 'cat' },
      { signal: abort.signal }
    )
  ).rejects.toMatchObject({ code: 'MEMORY_OPERATION_ABORTED' });
  expect((await service.getReceipt({ ...target, requestId: 'cancelled' })).value).toMatchObject({
    value: undefined,
  });
  const factories = definition.retrievalMemoryManagement.resolve;
  const corrupt = createRetrievalMemoryManagementService({
    ...definition,
    retrievalMemoryManagement: {
      resolve: {
        ...factories,
        inspect: async (r, options) => {
          const invocation = await factories.inspect(r, options);
          return {
            ...invocation,
            invoke: async (signal) => {
              const result = await invocation.invoke(signal);
              return result.status === 'completed'
                ? { ...result, value: { ...result.value, memoryId: 'other' } }
                : result;
            },
          };
        },
      },
    },
  });
  await expect(corrupt.inspect(target)).rejects.toMatchObject({
    failure: { code: 'STORAGE_FAILED' },
  });
});

it('cancels an embedding operation without cancelling another Memory run sharing the capability', async () => {
  const { service, index, embed } = await retrievalFixture();
  await service.create({ ...target, memoryId: 'other', requestId: 'create', index });
  let entered = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  embed.mockImplementation(async ({ inputs, signal }) => {
    if (inputs[0]?.text === 'blocked') {
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('cancelled', { cause: signal.reason })),
          { once: true }
        );
      });
    }
    return inputs.map(({ id }) => ({ id, vector: [1, 0] }));
  });
  const abort = new AbortController();
  const pending = service.ingest(
    { ...target, requestId: 'blocked', content: 'blocked' },
    { signal: abort.signal }
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: 'MEMORY_OPERATION_ABORTED' });
  await ready;
  await service.ingest({ ...target, memoryId: 'other', requestId: 'success', content: 'cat' });
  abort.abort();
  await rejected;
  expect((await service.list(target)).value).toMatchObject({ value: { entries: [] } });
  expect((await service.list({ ...target, memoryId: 'other' })).value).toMatchObject({
    value: { entries: [expect.any(Object)] },
  });
});

it('preserves a matched replay receipt when cancellation arrives after the backend read', async () => {
  const abort = new AbortController();
  let cancel = false;
  const { service, index } = await retrievalFixture({
    acquireBackend: async ({ path }) => {
      const backend = await openSqliteRetrievalBackend({ path });
      return {
        value: {
          ...backend,
          getReceipt: async (...args) => {
            const result = await backend.getReceipt(...args);
            if (cancel && result !== undefined) abort.abort();
            return result;
          },
        },
        release: () => backend.close(),
      };
    },
  });
  const input = { ...target, requestId: 'create', index };
  const original = await service.create(input);
  cancel = true;
  expect(await service.create(input, { signal: abort.signal })).toEqual(original);
  expect(abort.signal.aborted).toBe(true);
});
