import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowBundle } from '@ta-agent/workflow-bundle';
import { expect, it, vi } from 'vitest';
import { recordBundle, recordInspectionDefinition } from './consumers/record-bundle.js';
import { recordUpdateDefinition, type UpdatePorts } from './consumers/record-update.js';
import { SqliteRecords } from './support/sqlite-records.js';

const input = { enabled: true, id: 'document', title: 'edited' };

it('updates and inspects through a shared class adapter, then reopens its durable database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-bundle-'));
  const file = join(directory, 'records.sqlite');
  try {
    const records = new SqliteRecords(file);
    const close = vi.spyOn(records, 'close');
    try {
      records.seed(input.id, 'original');
      const bundle = recordBundle({ records, titleLimit: () => Promise.resolve(80) });
      await expect(bundle.workflows.update.run({ input })).resolves.toEqual({
        status: 'updated',
        record: { revision: 2, title: 'edited' },
      });
      await expect(bundle.workflows.inspect.run({ input: { id: input.id } })).resolves.toEqual({
        revision: 2,
        title: 'edited',
      });
      expect(close).not.toHaveBeenCalled();
    } finally {
      records.close();
    }
    expect(close).toHaveBeenCalledTimes(1);
    const reopened = new SqliteRecords(file);
    try {
      const bundle = recordBundle({ records: reopened, titleLimit: () => Promise.resolve(80) });
      await expect(bundle.workflows.inspect.run({ input: { id: input.id } })).resolves.toEqual({
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

it('leaves CAS authority with the store when two calls to a Bundle member race', async () => {
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
        compareAndSwap: records.compareAndSwap.bind(records),
      },
      titleLimit: () => Promise.resolve(80),
    };
    const bundle = recordBundle(resources);
    const results = await Promise.allSettled([
      bundle.workflows.update.run({ input }),
      bundle.workflows.update.run({ input: { ...input, title: 'other' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { message: 'Revision conflict.' } },
    ]);
    await expect(bundle.workflows.inspect.run({ input: { id: input.id } })).resolves.toMatchObject({
      revision: 2,
    });
  } finally {
    records.close();
  }
});

it('preserves a durable member commit when its hook fails and keeps the sibling reader usable', async () => {
  const records = new SqliteRecords(':memory:');
  const close = vi.spyOn(records, 'close');
  const failure = new Error('post-commit cleanup failed');
  try {
    records.seed(input.id, 'original');
    const bundle = new WorkflowBundle({
      resources: { records, titleLimit: () => Promise.resolve(80) },
      workflows: {
        update: {
          ...recordUpdateDefinition(),
          lifecycle: {
            onFinally: () => {
              throw failure;
            },
          },
        },
        inspect: recordInspectionDefinition(),
      },
    });
    await expect(bundle.workflows.update.run({ input })).rejects.toBe(failure);
    await expect(bundle.workflows.inspect.run({ input: { id: input.id } })).resolves.toEqual({
      revision: 2,
      title: 'edited',
    });
    expect(close).not.toHaveBeenCalled();
  } finally {
    records.close();
  }
});
