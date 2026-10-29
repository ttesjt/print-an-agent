import { expect, it } from 'vitest';
import { assertMemoryReply } from '../../src/memory/correlation.js';
import { contextCodecs } from '../../src/memory/schemas/context.js';
import { retrievalCodecs } from '../../src/memory/schemas/retrieval.js';

const request = { agentId: 'a', memoryId: 'main', requestId: 'request' };
it('correlates targets, requests, operation and native outcome without inventing a native ID mapping', () => {
  const receipt = {
    memoryId: '["native","a","main"]',
    requestId: 'request',
    operation: 'apply',
    status: 'committed',
  };
  const reply = {
    status: 'committed',
    value: { target: { agentId: 'a', memoryId: 'main' }, status: 'committed', receipt },
    notices: [],
  };
  expect(() => assertMemoryReply('apply', request, reply)).not.toThrow();
  expect(() =>
    assertMemoryReply('apply', request, {
      ...reply,
      value: { ...reply.value, target: { agentId: 'b', memoryId: 'main' } },
    })
  ).toThrow();
  expect(() =>
    assertMemoryReply('apply', request, {
      ...reply,
      value: { ...reply.value, receipt: { ...receipt, requestId: 'other' } },
    })
  ).toThrow();
  expect(() => assertMemoryReply('configure', request, reply)).toThrow();
  expect(() =>
    assertMemoryReply('apply', request, {
      ...reply,
      value: { ...reply.value, status: 'unchanged' },
    })
  ).toThrow();
  expect(() =>
    assertMemoryReply('getReceipt', request, {
      status: 'succeeded',
      target: request,
      value: { ...receipt, requestId: 'other' },
    })
  ).toThrow();
  expect(() =>
    assertMemoryReply('apply', request, {
      status: 'indeterminate',
      recovery: { ...request, memoryId: 'other' },
    })
  ).toThrow();
});

it('preserves optional metadata and render inputs without injecting domain defaults into the fingerprint', () => {
  const create = {
    ...request,
    items: [{ content: 'raw\n', metadata: { nested: [1, { ok: true }, null] } }],
  };
  expect(contextCodecs.create.input.decode(create)).toEqual(create);
  const ingest = { ...request, content: 'body' };
  expect(retrievalCodecs.ingest.input.decode(ingest)).toEqual(ingest);
  expect(() =>
    contextCodecs.apply.input.decode({
      ...request,
      expectedRevision: 1,
      commands: [{ op: 'add', itemId: 'not-user-controlled', content: 'x' }],
    })
  ).toThrow();
  expect(() =>
    retrievalCodecs.search.input.decode({
      agentId: 'a',
      memoryId: 'main',
      query: 'q',
      filter: { op: 'eq', path: ['x'], value: true, extra: true },
    })
  ).toThrow();
});
