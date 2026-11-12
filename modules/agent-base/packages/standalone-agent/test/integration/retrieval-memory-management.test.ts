import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  createAgentManagementService,
  createRetrievalMemoryManagementService,
  scopedAgentMemoryId,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity';
import { createStandaloneDirectorySetup } from '../../src/index.js';
import { resourceProfileConfig } from '../support/resource-profile.js';
import {
  retrievalFixture,
  target,
  receipt,
  modelFixture,
} from '../support/retrieval-management.js';

it('uses real scoped vectors, revisions, filters, pagination, citations and synchronous publication without a chat runtime', async () => {
  const { agents, definition, embed, acquireChunker } = await retrievalFixture();
  await agents.disable({ agentId: parseAgentId('a'), expectedIdentityRevision: 1 });
  const materialize = vi.fn(definition.runtime.materialize);
  const service = createRetrievalMemoryManagementService({
    ...definition,
    runtime: { ...definition.runtime, materialize },
  });
  const a = receipt(
    (
      await service.ingest({
        ...target,
        requestId: 'a',
        content: 'cat fact',
        metadata: { kind: 'cat', nested: { ok: true } },
        source: { ref: 'urn:cat', label: 'Cat' },
      })
    ).value
  );
  const b = receipt(
    (
      await service.ingest({
        ...target,
        requestId: 'b',
        content: 'dog fact',
        metadata: { kind: 'dog' },
      })
    ).value
  );
  const list = (await service.list({ ...target, limit: 1 })).value;
  if (list.status !== 'completed') throw new Error('Unexpected skip');
  expect(list.value.entries).toHaveLength(1);
  expect(list.value.nextCursor).toBeTruthy();
  const more = (await service.list({ ...target, limit: 1, cursor: list.value.nextCursor! })).value;
  expect(more).toMatchObject({
    status: 'completed',
    value: { entries: [expect.any(Object)], nextCursor: null },
  });
  expect((await service.get({ ...target, entryId: a.entryId! })).value).toMatchObject({
    status: 'completed',
    value: { content: 'cat fact', source: { ref: 'urn:cat' } },
  });
  const search = (
    await service.search({
      ...target,
      query: 'cat',
      filter: { op: 'eq', path: ['kind'], value: 'cat' },
    })
  ).value;
  expect(search).toMatchObject({ status: 'completed', value: { hits: [{ entryId: a.entryId }] } });
  const context = (
    await service.readContext({ ...target, query: 'cat', maxChunks: 1, maxTokens: 500 })
  ).value;
  expect(context).toMatchObject({
    status: 'completed',
    value: { citations: [{ entryId: a.entryId }] },
  });
  if (context.status !== 'completed') throw new Error('Unexpected skip');
  expect(context.value.measurement?.tokens).toBeGreaterThan(0);
  const calls = embed.mock.calls.length;
  await service.update({
    ...target,
    requestId: 'update',
    entryId: a.entryId!,
    expectedRevision: 1,
    content: 'dog updated',
    metadata: { kind: 'dog' },
  });
  expect(
    (
      await service.search({
        ...target,
        query: 'cat',
        filter: { op: 'eq', path: ['kind'], value: 'cat' },
      })
    ).value
  ).toMatchObject({ value: { hits: [] } });
  const indexed = receipt(
    (
      await service.reindex({
        ...target,
        requestId: 'reindex',
        entryId: a.entryId!,
        expectedRevision: 2,
      })
    ).value
  );
  expect(indexed.entryRevision).toBe(2);
  expect(embed.mock.calls.length).toBeGreaterThan(calls);
  await expect(
    service.update({
      ...target,
      requestId: 'stale',
      entryId: a.entryId!,
      expectedRevision: 1,
      content: 'lost',
    })
  ).rejects.toMatchObject({ failure: { code: 'REVISION_CONFLICT' } });
  await service.remove({
    ...target,
    requestId: 'remove',
    entryId: b.entryId!,
    expectedRevision: 1,
  });
  expect((await service.search({ ...target, query: 'dog' })).value).toMatchObject({
    value: { hits: [{ entryId: a.entryId }] },
  });
  expect(materialize).not.toHaveBeenCalled();
  expect(acquireChunker).toHaveBeenCalledOnce();
});

it('recovers after reopen without embedding and still supports content management', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retrieval-management-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const model = modelFixture();
  const runtime = { rootDirectory: root, readEnvironmentVariable: () => undefined };
  const first = createStandaloneDirectorySetup(runtime, {
    storageNamespaceId: 'stable',
    retrieval: model.options,
  });
  onTestFinished(() => first.close());
  await createAgentManagementService(first.definition).create({
    identity: { id: 'a' },
    config: resourceProfileConfig(),
  });
  const service = createRetrievalMemoryManagementService(first.definition);
  const create = { ...target, requestId: 'create', index: model.index };
  const input = { ...target, requestId: 'ingest', content: 'cat fact' };
  const originalCreate = await service.create(create);
  const original = await service.ingest(input);
  const entryId = receipt(original.value).entryId!;
  await first.close();
  const second = createStandaloneDirectorySetup(runtime, {
    storageNamespaceId: 'stable',
    retrieval: {},
  });
  onTestFinished(() => second.close());
  const reopened = createRetrievalMemoryManagementService(second.definition);
  expect(await reopened.create(create)).toEqual(originalCreate);
  expect(await reopened.ingest(input)).toEqual(original);
  expect((await reopened.get({ ...target, entryId })).value).toMatchObject({
    value: { content: 'cat fact' },
  });
  expect((await reopened.list(target)).value).toMatchObject({ value: { entries: [{ entryId }] } });
  await expect(reopened.search({ ...target, query: 'cat' })).rejects.toMatchObject({
    failure: { code: 'UNSUPPORTED_CAPABILITY' },
  });
  await expect(reopened.ingest({ ...input, content: 'different' })).rejects.toMatchObject({
    failure: { code: 'REQUEST_CONFLICT' },
  });
  await reopened.remove({ ...target, requestId: 'remove', entryId, expectedRevision: 1 });
  expect((await reopened.list(target)).value).toMatchObject({ value: { entries: [] } });
  expect(model.embed).toHaveBeenCalledOnce();
});

it('isolates Agent/Memory entries and cursor scope, and preserves concurrent CAS ordering', async () => {
  const { service, agents } = await retrievalFixture();
  const a = receipt((await service.ingest({ ...target, requestId: 'a', content: 'a' })).value);
  await service.ingest({ ...target, requestId: 'b', content: 'b' });
  const page = (await service.list({ ...target, limit: 1 })).value;
  if (page.status !== 'completed') throw new Error('Unexpected skip');
  await agents.create({ identity: { id: 'b' }, config: resourceProfileConfig() });
  await expect(service.get({ ...target, agentId: 'b', entryId: a.entryId! })).rejects.toMatchObject(
    { failure: { code: 'MEMORY_NOT_FOUND' } }
  );
  await expect(
    service.list({ ...target, agentId: 'b', cursor: page.value.nextCursor! })
  ).rejects.toMatchObject({ code: 'MEMORY_OPERATION_FAILED' });
  const changes = await Promise.allSettled(
    ['x', 'y'].map((content) =>
      service.update({
        ...target,
        requestId: content,
        entryId: a.entryId!,
        expectedRevision: 1,
        content,
      })
    )
  );
  expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(changes.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { failure: { code: 'REVISION_CONFLICT' } },
  });
  expect((await service.inspect(target)).value).toMatchObject({
    value: { memoryId: scopedAgentMemoryId('retrieval-test', 'a', 'knowledge') },
  });
});
