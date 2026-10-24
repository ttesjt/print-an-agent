import { matchesMetadata, type MetadataFilter, type JsonObject } from '@ta-agent/retrieval-memory';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('matches the domain filter algebra through parameterized SQL including arbitrary keys and primitive types', async () => {
  const f = await fixture();
  await f.create();
  const records: JsonObject[] = [
    {
      value: true,
      nested: { 'a.b': null, 'q"; DROP TABLE rm_entries; --': 'safe', 'a\0b': 'x\0y', '': 1 },
      array: ['x'],
    },
    { value: 1, nested: { 'a.b': 'null' }, array: { '0': 'x' } },
    { value: null, nested: {} },
    {},
    { value: false },
    { value: 'true' },
  ];
  const entries = [];
  for (const [i, metadata] of records.entries()) {
    const { receipt } = await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId: `r${i}`,
      content: 'aligned',
      metadata,
    });
    entries.push({ entryId: receipt.entryId!, metadata });
  }
  const filters: MetadataFilter[] = [
    ...[true, false, 1, null, 'true'].map((value) => ({
      op: 'eq' as const,
      path: ['value'],
      value,
    })),
    { op: 'in', path: ['value'], values: [false, null, 'true'] },
    { op: 'exists', path: ['missing'], value: false },
    { op: 'exists', path: ['value'], value: true },
    { op: 'exists', path: ['nested', 'a.b'], value: false },
    { op: 'eq', path: ['nested', 'a.b'], value: null },
    { op: 'eq', path: ['nested', 'q"; DROP TABLE rm_entries; --'], value: 'safe' },
    { op: 'eq', path: ['nested', 'a\0b'], value: 'x\0y' },
    { op: 'eq', path: ['nested', ''], value: 1 },
    { op: 'eq', path: ['array', '0'], value: 'x' },
    {
      op: 'and',
      filters: [
        { op: 'exists', path: ['value'], value: true },
        { op: 'in', path: ['value'], values: [true, 1] },
      ],
    },
  ];
  for (const filter of filters) {
    const actual = (await f.search('space', { filter })).hits.map((hit) => hit.entryId).sort();
    const expected = entries
      .filter((entry) => matchesMetadata(entry.metadata, filter))
      .map((entry) => entry.entryId)
      .sort();
    expect(actual, JSON.stringify(filter)).toEqual(expected);
  }
});
