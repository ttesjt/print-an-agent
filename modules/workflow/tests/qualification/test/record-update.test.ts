import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { recordUpdate, type UpdatePorts, type UpdateResult } from './consumers/record-update.js';
import { SqliteRecords } from './support/sqlite-records.js';

const input = { enabled: true, id: 'document-1', title: 'edited' };

it('updates a durable record through independent ports, then reopens the database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-records-'));
  const file = join(directory, 'catalog.sqlite');
  try {
    const records = new SqliteRecords(file);
    try {
      records.seed(input.id, 'original');
      const close = vi.spyOn(records, 'close');
      const result = await recordUpdate().run({
        input,
        resources: { records, titleLimit: () => Promise.resolve(80) },
      });
      expect(result).toEqual({ status: 'updated', record: { revision: 2, title: 'edited' } });
      expect(close).not.toHaveBeenCalled();
    } finally {
      records.close();
    }
    const reopened = new SqliteRecords(file);
    try {
      expect(await reopened.read(input.id, new AbortController().signal)).toEqual({
        revision: 2,
        title: 'edited',
      });
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps CAS authority in the store when separate Workflow runs race', async () => {
  const records = new SqliteRecords(':memory:');
  try {
    records.seed(input.id, 'original');
    const ready = Promise.withResolvers<void>();
    let count = 0;
    const resources: UpdatePorts = {
      records: {
        read: async (id, signal) => {
          const record = await records.read(id, signal);
          if (++count === 2) ready.resolve();
          await ready.promise;
          return record;
        },
        compareAndSwap: (id, revision, title, signal) =>
          records.compareAndSwap(id, revision, title, signal),
      },
      titleLimit: () => Promise.resolve(80),
    };
    const flow = recordUpdate();
    const results = await Promise.allSettled([
      flow.run({ input, resources }),
      flow.run({ input: { ...input, title: 'other' }, resources }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: { message: 'Revision conflict.' } },
    ]);
    expect((await records.read(input.id, new AbortController().signal)).revision).toBe(2);
  } finally {
    records.close();
  }
});

it('returns a truthful skipped union and does not overwrite existing host state', async () => {
  const unused = vi.fn(() => {
    throw new Error('should not use ports');
  });
  const resources: UpdatePorts = {
    records: { read: unused, compareAndSwap: unused },
    titleLimit: unused,
  };
  const host = { title: 'keep me', revision: 7 };
  const result: UpdateResult = await recordUpdate().run({
    input: { ...input, enabled: false },
    resources,
  });
  if (result.status === 'updated') Object.assign(host, result.record);
  expect(result).toEqual({ status: 'not-updated' });
  expect(host).toEqual({ title: 'keep me', revision: 7 });
  expect(unused).not.toHaveBeenCalled();
});

it('rejects business validation without replacing a failure with the default result', async () => {
  const records = new SqliteRecords(':memory:');
  try {
    records.seed(input.id, 'original');
    await expect(
      recordUpdate().run({ input, resources: { records, titleLimit: () => Promise.resolve(1) } })
    ).rejects.toThrow('Title rejected.');
    expect(await records.read(input.id, new AbortController().signal)).toEqual({
      title: 'original',
      revision: 1,
    });
  } finally {
    records.close();
  }
});
