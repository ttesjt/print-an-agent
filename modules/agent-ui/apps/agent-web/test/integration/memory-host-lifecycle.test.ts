// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  ContextMemoryError,
  createMemoryApplyDefinition,
  createMemoryGetReceiptDefinition,
} from '@print-an-agent/context-memory';
import {
  createRetrievalIngestDefinition,
  createRetrievalReceiptDefinition,
} from '@print-an-agent/retrieval-memory';
import { skipWorkflow } from '@print-an-agent/workflow-core';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createDirectoryCollectionHost } from '../../src/node/collections/directory-host.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { connectHttpMemory } from '../../src/memory/browser.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { memoryHost, memoryOptions } from '../support/memory.js';

const target = { agentId: 'a', memoryId: 'main' };
it.each(['none', 'context', 'retrieval'] as const)(
  'installs only explicitly enabled features (%s)',
  async (kind) => {
    const f = memoryOptions();
    const options = {
      provisioning: {
        storageNamespaceId: 'optional',
        ...(kind === 'context' ? { context: f.options.provisioning.context } : {}),
        ...(kind === 'retrieval' ? { retrieval: f.options.provisioning.retrieval } : {}),
      },
    };
    const { memory } = await memoryHost(options);
    expect(memory.context !== undefined).toBe(kind === 'context');
    expect(memory.retrieval !== undefined).toBe(kind === 'retrieval');
    expect(f.embed).not.toHaveBeenCalled();
  }
);

it('reports committed cleanup failures separately and recovers receipt-query post-processing failures', async () => {
  const f = memoryOptions();
  const { memory } = await memoryHost({
    ...f.options,
    provisioning: {
      ...f.options.provisioning,
      context: {
        ...f.options.provisioning.context,
        workflows: {
          apply: createMemoryApplyDefinition({
            lifecycle: {
              onFinally: () => {
                throw new ContextMemoryError('CLEANUP_FAILED', 'secret /db.sqlite');
              },
            },
          }),
          getReceipt: createMemoryGetReceiptDefinition({
            lifecycle: {
              onFinally: () => {
                throw new Error('secret receipt cleanup');
              },
            },
          }),
        },
      },
      retrieval: {
        ...f.options.provisioning.retrieval,
        workflows: {
          ingest: createRetrievalIngestDefinition({
            lifecycle: {
              onFinally: () => {
                throw new Error('secret /db.sqlite');
              },
            },
          }),
          getReceipt: createRetrievalReceiptDefinition({
            lifecycle: {
              onFinally: () => {
                throw new Error('secret receipt cleanup');
              },
            },
          }),
        },
      },
    },
  });
  await memory.context!.create({ ...target, requestId: 'create' });
  const result = await memory.context!.apply({
    ...target,
    requestId: 'apply',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'cat' }],
  });
  expect(result).toMatchObject({
    status: 'committed',
    value: { receipt: { revision: 2 } },
    notices: [{ code: 'CLEANUP_FAILED' }],
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(await memory.context!.getReceipt({ ...target, requestId: 'apply' })).toMatchObject({
    status: 'succeeded',
    value: { revision: 2 },
    notices: [{ code: 'CLEANUP_FAILED' }],
  });
  await memory.retrieval!.create({ ...target, requestId: 'create', index: f.index });
  expect(
    await memory.retrieval!.ingest({ ...target, requestId: 'ingest', content: 'cat' })
  ).toMatchObject({ status: 'committed', notices: [{ code: 'CLEANUP_FAILED' }] });
  expect(await memory.retrieval!.getReceipt({ ...target, requestId: 'ingest' })).toMatchObject({
    status: 'succeeded',
    value: { requestId: 'ingest' },
    notices: [{ code: 'CLEANUP_FAILED' }],
  });
});

it.each(['disconnect', 'shutdown'] as const)(
  'joins business cancellation before releasing resources on %s',
  async (mode) => {
    const f = memoryOptions();
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let settled = false;
    f.embed.mockImplementation(async ({ signal }) => {
      entered();
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      } finally {
        settled = true;
      }
      return [];
    });
    const release = vi.fn(() => {
      expect(settled).toBe(true);
    });
    const acquire = f.options.provisioning.retrieval!.acquireEmbedding!;
    const { server, memory } = await memoryHost({
      ...f.options,
      provisioning: {
        ...f.options.provisioning,
        retrieval: {
          ...f.options.provisioning.retrieval,
          acquireEmbedding: async (...args) => ({ ...(await acquire(...args)), release }),
        },
      },
    });
    await memory.retrieval!.create({ ...target, requestId: 'create', index: f.index });
    const controller = new AbortController();
    const pending = memory.retrieval!.ingest({
      ...target,
      requestId: 'blocked',
      content: 'blocked',
      signal: controller.signal,
    });
    await ready;
    if (mode === 'disconnect') {
      controller.abort();
      await vi.waitFor(() => expect(settled).toBe(true));
      expect(release).not.toHaveBeenCalled();
      expect(await memory.retrieval!.list(target)).toMatchObject({
        status: 'succeeded',
        value: { entries: [] },
      });
    }
    await server.close();
    expect(await pending).toMatchObject({ status: 'indeterminate' });
    expect(release).toHaveBeenCalledOnce();
    await server.close();
    expect(release).toHaveBeenCalledOnce();
  }
);

it('binds Collection ports permanently and closes every Collection-owned backend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-memory-collections-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const f = memoryOptions();
  const collections = await createDirectoryCollectionHost({ memory: f.options });
  const server = await startLocalAgentWebServer({
    collections,
    closeResources: () => collections.close(),
  });
  onTestFinished(() => server.close());
  const signal = new AbortController().signal;
  const open = async (directory: string) => {
    const opened = await collections.open({ rootDirectory: join(root, directory) }, signal);
    if (!opened.ok) throw new Error('Could not open Collection');
    const baseUrl = `${server.origin}/api/collections/${opened.collection.key}`;
    const agents = createHttpAgentWebPorts({ baseUrl }).agents;
    await agents.createAgent({
      identity: { agentId: 'a', displayName: 'A' },
      config: DEFAULT_AGENT_CONFIG,
    });
    return { key: opened.collection.key, ports: await connectHttpMemory({ baseUrl }) };
  };
  const a = await open('a');
  await a.ports.context!.create({ ...target, requestId: 'create', items: [{ content: 'first' }] });
  const b = await open('b');
  expect(await b.ports.context!.inspect(target)).toMatchObject({
    status: 'failed',
    failure: { domainCode: 'MEMORY_NOT_FOUND' },
  });
  await b.ports.context!.create({ ...target, requestId: 'create', items: [{ content: 'second' }] });
  expect(await a.ports.context!.readContext(target)).toMatchObject({
    status: 'succeeded',
    value: { text: 'first' },
  });
  await server.close();
  expect(collections.resolve(a.key)).toBeUndefined();
  expect(collections.resolve(b.key)).toBeUndefined();
  await expect(collections.open({ rootDirectory: join(root, 'c') }, signal)).rejects.toThrow();
});

it('still exposes existing content over HTTP after reopening without embedding configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-memory-reopen-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const f = memoryOptions();
  const first = createAgentBaseWebPorts({
    persistence: { kind: 'directory', rootDirectory: root },
    memory: f.options,
  });
  onTestFinished(() => first.close());
  await first.agents.createAgent({
    identity: { agentId: 'a', displayName: 'A' },
    config: DEFAULT_AGENT_CONFIG,
  });
  await first.memory!.retrieval!.create({ ...target, requestId: 'create', index: f.index });
  const ingested = await first.memory!.retrieval!.ingest({
    ...target,
    requestId: 'ingest',
    content: 'cat',
  });
  if (ingested.status !== 'committed') throw new Error('Missing Entry');
  const entryId = ingested.value.receipt.entryId!;
  await first.close();
  const next = createAgentBaseWebPorts({
    persistence: { kind: 'directory', rootDirectory: root },
    memory: {
      provisioning: {
        storageNamespaceId: f.options.provisioning.storageNamespaceId,
        retrieval: {},
      },
    },
  });
  const server = await startLocalAgentWebServer({
    ports: next,
    closeResources: () => next.close(),
  });
  onTestFinished(() => server.close());
  const memory = await connectHttpMemory({ baseUrl: server.origin + '/api' });
  expect(await memory.retrieval!.list(target)).toMatchObject({
    status: 'succeeded',
    value: { entries: [{ entryId }] },
  });
  expect(await memory.retrieval!.search({ ...target, query: 'cat' })).toMatchObject({
    status: 'failed',
    failure: { domainCode: 'UNSUPPORTED_CAPABILITY' },
  });
  expect(
    await memory.retrieval!.ingest({ ...target, requestId: 'ingest', content: 'cat' })
  ).toMatchObject({ status: 'committed' });
  expect(
    await memory.retrieval!.remove({ ...target, requestId: 'remove', entryId, expectedRevision: 1 })
  ).toMatchObject({ status: 'committed' });
  expect(f.embed).toHaveBeenCalledOnce();
});

it('keeps native Workflow skips distinct from committed mutations', async () => {
  const f = memoryOptions();
  const { memory } = await memoryHost({
    ...f.options,
    provisioning: {
      ...f.options.provisioning,
      retrieval: {
        ...f.options.provisioning.retrieval,
        workflows: {
          ingest: createRetrievalIngestDefinition({
            condition: () => skipWorkflow('disabled by policy'),
          }),
        },
      },
    },
  });
  await memory.retrieval!.create({ ...target, requestId: 'create', index: f.index });
  expect(
    await memory.retrieval!.ingest({ ...target, requestId: 'skipped', content: 'cat' })
  ).toEqual({ status: 'skipped', target, reason: 'Workflow condition skipped execution.' });
  expect(await memory.retrieval!.getReceipt({ ...target, requestId: 'skipped' })).toMatchObject({
    status: 'succeeded',
    value: null,
  });
});

it('does not report successful shutdown after an owned capability release fails', async () => {
  const f = memoryOptions();
  const acquire = f.options.provisioning.context!.acquireCounter!;
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    memory: {
      provisioning: {
        storageNamespaceId: 'cleanup',
        context: {
          ...f.options.provisioning.context,
          acquireCounter: async (...args) => ({
            ...(await acquire(...args)),
            release: () => {
              throw new Error('release failed');
            },
          }),
        },
      },
    },
  });
  const server = await startLocalAgentWebServer({
    ports: backend,
    closeResources: () => backend.close(),
  });
  await backend.agents.createAgent({
    identity: { agentId: 'a', displayName: 'A' },
    config: DEFAULT_AGENT_CONFIG,
  });
  await backend.memory!.context!.create({ ...target, requestId: 'create' });
  await expect(server.close()).rejects.toThrow('Local host shutdown failed');
  await expect(server.close()).rejects.toThrow('Local host shutdown failed');
});

it('does not close a borrowed backend when resource ownership was not delegated', async () => {
  const f = memoryOptions();
  const released = vi.fn();
  const acquire = f.options.provisioning.context!.acquireCounter!;
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    memory: {
      provisioning: {
        storageNamespaceId: 'borrowed',
        context: {
          ...f.options.provisioning.context,
          acquireCounter: async (...args) => ({
            ...(await acquire(...args)),
            release: () => {
              released();
            },
          }),
        },
      },
    },
  });
  onTestFinished(() => backend.close());
  const server = await startLocalAgentWebServer({ ports: backend });
  onTestFinished(() => server.close());
  await backend.agents.createAgent({
    identity: { agentId: 'a', displayName: 'A' },
    config: DEFAULT_AGENT_CONFIG,
  });
  await backend.memory!.context!.create({ ...target, requestId: 'create' });
  await server.close();
  expect(released).not.toHaveBeenCalled();
  expect(await backend.memory!.context!.readContext(target)).toMatchObject({ status: 'succeeded' });
  await backend.close();
  expect(released).toHaveBeenCalledOnce();
});
