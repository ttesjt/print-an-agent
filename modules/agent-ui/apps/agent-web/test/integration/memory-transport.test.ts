// @vitest-environment node
import { expect, it } from 'vitest';
import { connectHttpMemory } from '../../src/memory/browser.js';
import { memoryHost, memoryOptions } from '../support/memory.js';
import { contextCodecs } from '../../src/memory/schemas/context.js';
import { retrievalCodecs } from '../../src/memory/schemas/retrieval.js';

const target = { agentId: 'a', memoryId: 'main' };
it('round-trips Context state, commands, config, measurements, CAS and receipt recovery using strict codecs', async () => {
  const { memory } = await memoryHost();
  const context = memory.context!;
  expect(await context.inspect(target)).toMatchObject({
    status: 'failed',
    failure: { domainCode: 'MEMORY_NOT_FOUND' },
  });
  const input = {
    ...target,
    requestId: 'create',
    items: [{ content: ' first\n', metadata: { tags: ['raw', { nested: true }] } }],
    config: { maxContextTokens: 1000 },
  };
  expect(await context.create(input)).toMatchObject({
    status: 'committed',
    value: { status: 'committed', receipt: { revision: 1 } },
  });
  const snapshot = await context.inspect(target);
  if (snapshot.status !== 'succeeded' || snapshot.value === null)
    throw new Error('Missing snapshot');
  const itemId = snapshot.value.items[0]!.id;
  expect(snapshot.value.items[0]?.content).toBe(' first\n');
  expect(snapshot.value.measurement.tokens).toBeGreaterThan(0);
  await context.apply({
    ...target,
    requestId: 'apply',
    expectedRevision: 1,
    commands: [
      { op: 'replace', itemId, content: 'new' },
      { op: 'add', content: 'second' },
    ],
  });
  await expect(
    context.apply({ ...target, requestId: 'stale', expectedRevision: 1, commands: [] })
  ).resolves.toMatchObject({
    status: 'rejected',
    failure: { domainCode: 'REVISION_CONFLICT', details: { actualRevision: 2 } },
  });
  await context.configure({
    ...target,
    requestId: 'configure',
    expectedRevision: 2,
    config: { render: { format: 'text', separator: '\n\n' } },
  });
  expect(await context.readContext(target)).toMatchObject({
    status: 'succeeded',
    value: { text: 'new\n\nsecond', budget: { status: 'fits' } },
  });
  expect(await context.getReceipt({ ...target, requestId: 'missing' })).toMatchObject({
    status: 'succeeded',
    value: null,
  });
  const receipt = await context.getReceipt({ ...target, requestId: 'create' });
  expect(receipt).toMatchObject({
    status: 'succeeded',
    value: { requestId: 'create', revision: 1 },
  });
  expect(await context.create(input)).toMatchObject({
    status: 'committed',
    value: { receipt: { revision: 1 } },
  });
});

it('round-trips real vector search, pagination, metadata, citations, update, remove and reindex', async () => {
  const { options, index } = memoryOptions();
  const { memory } = await memoryHost(options);
  const retrieval = memory.retrieval!;
  expect(memory.capabilities.retrieval?.embeddings).toEqual([
    { ...index, label: 'Fixture embedding' },
  ]);
  await retrieval.create({ ...target, requestId: 'create', index });
  const original = await retrieval.ingest({
    ...target,
    requestId: 'cat',
    content: 'cat fact',
    metadata: { kind: 'cat', nested: { tags: [1, false, null] } },
    source: { ref: 'urn:cat', label: 'Cat' },
  });
  if (original.status !== 'committed') throw new Error('Expected commit');
  const entryId = original.value.receipt.entryId!;
  await retrieval.ingest({ ...target, requestId: 'dog', content: 'dog fact' });
  const page = await retrieval.list({ ...target, limit: 1 });
  if (page.status !== 'succeeded') throw new Error('Missing page');
  expect(page.value.entries).toHaveLength(1);
  expect(
    await retrieval.list({ ...target, limit: 1, cursor: page.value.nextCursor! })
  ).toMatchObject({ status: 'succeeded', value: { nextCursor: null } });
  expect(await retrieval.get({ ...target, entryId })).toMatchObject({
    status: 'succeeded',
    value: { content: 'cat fact', source: { ref: 'urn:cat' } },
  });
  expect(
    await retrieval.search({
      ...target,
      query: 'cat',
      filter: { op: 'eq', path: ['kind'], value: 'cat' },
    })
  ).toMatchObject({ status: 'succeeded', value: { hits: [{ entryId }] } });
  expect(
    await retrieval.readContext({ ...target, query: 'cat', maxChunks: 1, maxTokens: 1000 })
  ).toMatchObject({
    status: 'succeeded',
    value: { citations: [{ entryId }], outcome: 'selected' },
  });
  await retrieval.update({
    ...target,
    requestId: 'update',
    entryId,
    expectedRevision: 1,
    content: 'dog updated',
    metadata: { kind: 'dog' },
    source: null,
  });
  expect(
    await retrieval.reindex({ ...target, requestId: 'reindex', entryId, expectedRevision: 2 })
  ).toMatchObject({ status: 'committed', value: { receipt: { entryRevision: 2 } } });
  expect(
    await retrieval.remove({ ...target, requestId: 'remove', entryId, expectedRevision: 2 })
  ).toMatchObject({ status: 'committed' });
  expect(
    await retrieval.search({
      ...target,
      query: 'cat',
      filter: { op: 'eq', path: ['kind'], value: 'dog' },
    })
  ).toMatchObject({ status: 'succeeded', value: { hits: [] } });
});

it('accepts legal long Memory IDs and opaque cursors beyond Workspace ID length', async () => {
  const { options, index } = memoryOptions();
  const { memory } = await memoryHost(options);
  const long = { ...target, memoryId: '项目'.repeat(100) };
  await memory.retrieval!.create({ ...long, requestId: 'create', index });
  for (const requestId of ['one', 'two'])
    await memory.retrieval!.ingest({ ...long, requestId, content: requestId });
  const page = await memory.retrieval!.list({ ...long, limit: 1 });
  if (page.status !== 'succeeded') throw new Error('Missing page');
  expect(page.value.nextCursor!.length).toBeGreaterThan(256);
  expect(
    await memory.retrieval!.list({ ...long, limit: 1, cursor: page.value.nextCursor! })
  ).toMatchObject({ status: 'succeeded', value: { nextCursor: null } });
});

it.each(['context', 'retrieval'] as const)(
  'uses the same request for %s recovery after delivery loss, never reruns model work',
  async (domain) => {
    const { options, index, embed } = memoryOptions();
    const { baseUrl, memory } = await memoryHost(options);
    let lost = false;
    const client = await connectHttpMemory({
      baseUrl,
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (
          !lost &&
          init?.body ===
            JSON.stringify(
              domain === 'context'
                ? { domain, operation: 'create', input: { ...target, requestId: 'lost' } }
                : {
                    domain,
                    operation: 'ingest',
                    input: { ...target, requestId: 'lost', content: 'cat' },
                  }
            )
        ) {
          lost = true;
          await response.arrayBuffer();
          throw new TypeError('Lost delivery');
        }
        return response;
      },
    });
    if (domain === 'context') {
      const input = { ...target, requestId: 'lost' };
      expect(await client.context!.create(input)).toMatchObject({
        status: 'indeterminate',
        recovery: input,
      });
      expect(await client.context!.getReceipt(input)).toMatchObject({
        status: 'succeeded',
        value: { requestId: 'lost' },
      });
      expect(await client.context!.create(input)).toMatchObject({ status: 'committed' });
    } else {
      await memory.retrieval!.create({ ...target, requestId: 'create', index });
      const input = { ...target, requestId: 'lost', content: 'cat' };
      expect(await client.retrieval!.ingest(input)).toMatchObject({ status: 'indeterminate' });
      expect(await client.retrieval!.getReceipt({ ...target, requestId: 'lost' })).toMatchObject({
        status: 'succeeded',
        value: { requestId: 'lost' },
      });
      expect(await client.retrieval!.ingest(input)).toMatchObject({ status: 'committed' });
      expect(embed).toHaveBeenCalledOnce();
    }
    expect(lost).toBe(true);
  }
);

it('rejects unsupported fields and malformed Unicode before dispatch and rejects extra response fields', async () => {
  const { baseUrl } = await memoryHost();
  const request = await fetch(baseUrl + '/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: 'context',
      operation: 'create',
      input: { ...target, requestId: 'bad', databasePath: '/secret.db' },
    }),
  });
  expect(request.status).toBe(400);
  expect(() => contextCodecs.create.input.decode({ ...target, requestId: '\ud800' })).toThrow();
  expect(() =>
    retrievalCodecs.list.output.decode({
      status: 'succeeded',
      target,
      value: { space: {}, entries: [], nextCursor: null },
      stack: 'private',
    })
  ).toThrow();
});
