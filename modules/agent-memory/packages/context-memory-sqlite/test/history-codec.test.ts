import { expect, it } from 'vitest';
import { jsonValue } from '@print-an-agent/context-memory';
import { diffState, applyStateDelta } from '../src/history/delta.js';
import { encodeHistory, decodeHistory, historyChainLimit } from '../src/history/codec.js';
import { borrowed } from './support/fixtures.js';

it('validates explicit chain limits instead of silently accepting invalid settings', () => {
  expect(historyChainLimit()).toBe(32);
  expect(historyChainLimit({ maxDeltaChain: 1 })).toBe(1);
  for (const maxDeltaChain of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => historyChainLimit({ maxDeltaChain })).toThrow();
  // @ts-expect-error JavaScript configuration can supply null; it is not an omitted setting.
  expect(() => historyChainLimit({ maxDeltaChain: null })).toThrow();
});

it('round trips generated nested JSON states, array lengths, text and dangerous property names', () => {
  let seed = 1729;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  let previous = jsonValue({ text: '🎉'.repeat(100), items: [], config: {} });
  for (let index = 0; index < 250; index++) {
    const value = jsonValue({
      text: '🎉'.repeat(100) + String(next()),
      items: Array.from({ length: next() % 9 }, (_, i) => ({
        id: i,
        value: next(),
        meta: { title: '你好\n', values: [null, true, index] },
      })),
      config: index % 2 ? { separator: '\n', maxTokens: null } : {},
    });
    const actual = applyStateDelta(previous, diffState(previous, value));
    expect(actual).toEqual(value);
    expect(previous).not.toBe(actual);
    previous = value;
  }
  const dangerous = jsonValue(JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}'));
  expect(applyStateDelta({}, diffState({}, dangerous))).toEqual(dangerous);
  expect(Object.prototype).not.toHaveProperty('polluted');
});
it('rejects unknown operations, prototype traversal, missing values and sparse array assignments', () => {
  for (const patch of [
    [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
    [{ op: 'set', path: ['array', 10], value: true }],
    [{ op: 'set', path: ['x'] }],
    [{ op: 'resize', path: ['array'], length: 99 }],
    [{ op: 'text', path: ['text'], start: 1, deleteCount: 100, text: '' }],
    [{ op: 'bad', path: [] }],
  ])
    expect(() => applyStateDelta({ array: [1], text: 'abc' }, patch)).toThrow();
});
it('uses bounded economical deltas and verifies every reconstructed snapshot', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({
    memoryId: 'm',
    requestId: 'c',
    items: [{ content: 'a'.repeat(1500) }],
    config: { maxContextTokens: null },
  });
  const first = (await store.read('m'))!;
  let previous = first;
  let row = encodeHistory(first, undefined, 0, 2);
  expect(decodeHistory(row)).toEqual(first);
  for (let revision = 2; revision <= 5; revision++) {
    await mutations.apply({
      memoryId: 'm',
      requestId: String(revision),
      expectedRevision: previous.revision,
      commands: [
        {
          op: 'replace',
          itemId: previous.items[0]!.id,
          content: 'a'.repeat(1500) + String(revision),
        },
      ],
    });
    const snapshot = (await store.read('m'))!;
    const current = encodeHistory(snapshot, previous, row.depth, 2);
    expect(current.kind).toBe(revision === 4 ? 'base' : 'delta');
    expect(decodeHistory(current, previous, row.depth)).toEqual(snapshot);
    expect(() => decodeHistory({ ...current, digest: 'wrong' }, previous, row.depth)).toThrow();
    expect(() => decodeHistory({ ...current, format: 9 }, previous, row.depth)).toThrow();
    previous = snapshot;
    row = current;
  }
});
it('does not replace a logical snapshot with refreshed measurement on unchanged commit', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'c' });
  const before = (await store.read('m'))!;
  const result = await store.commit({
    request: { memoryId: 'm', requestId: 'cache', operation: 'apply', input: {} },
    expectedRevision: 1,
    state: {
      config: before.config,
      items: before.items,
      measurement: { ...before.measurement, tokens: before.measurement.tokens + 1 },
    },
    commandOutcomes: [],
  });
  expect(result.status).toBe('unchanged');
  expect(await store.read('m')).toEqual(before);
});
