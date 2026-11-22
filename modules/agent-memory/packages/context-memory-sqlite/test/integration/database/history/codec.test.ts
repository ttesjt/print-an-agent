import { expect, it } from 'vitest';
import { encodeHistory, decodeHistory } from '../../../../src/database/history/codec.js';

import { borrowed } from '../../../support/fixtures.js';

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
