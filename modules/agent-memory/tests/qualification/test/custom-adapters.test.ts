import { expect, it } from 'vitest';
import {
  MemoryMeter,
  type MemoryStore,
  type MemoryRenderer,
  type StoreCommit,
} from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import { consumer, vocabularyCounter } from './support/model.js';
import { borrowDatabase } from './support/storage.js';

it('replaces renderer, counter and store without bypassing full-render publication checks', async () => {
  const database = borrowDatabase();
  const sqlite = new SqliteMemoryStore({ database });
  class AuditedStore implements MemoryStore {
    commits = 0;
    read(memoryId: string, signal?: AbortSignal) {
      return sqlite.read(memoryId, signal);
    }
    getReceipt(memoryId: string, requestId: string, signal?: AbortSignal) {
      return sqlite.getReceipt(memoryId, requestId, signal);
    }
    commit(change: StoreCommit, signal?: AbortSignal) {
      this.commits++;
      return sqlite.commit(change, signal);
    }
  }
  const store = new AuditedStore();
  const renderer: MemoryRenderer = {
    id: 'qualification:delimited:v1',
    render: (items, options) => {
      if (options.format !== 'custom' || typeof options.options.separator !== 'string')
        throw new Error('The consumer requires an explicit separator.');
      return Promise.resolve(
        `[${items.map((item) => item.content).join(options.options.separator)}]`
      );
    },
  };
  const counter = vocabularyCounter('qualification:double-codepoints:v1', 2);
  const client = consumer(
    store,
    () => {
      expect(database.isTransaction).toBe(false);
      return [{ op: 'add', content: 'zz' }];
    },
    {
      resources: {
        meter: new MemoryMeter({ renderer, counter }),
        defaults: {
          measurementRef: counter.descriptor.measurementRef,
          maxContextTokens: 30,
          render: { format: 'custom', rendererRef: renderer.id, options: { separator: '|' } },
        },
      },
    }
  );
  await client.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'abc' }] },
  });
  await client.bundle.workflows.observe.run({
    input: { memoryId: 'a', requestId: 'observe', context: [] },
  });
  expect(await client.bundle.workflows.readContext.run({ input: { memoryId: 'a' } })).toMatchObject(
    {
      text: '[abc|zz]',
      measurement: { tokens: 16 },
      snapshot: { revision: 2 },
    }
  );
  await expect(
    client.bundle.workflows.apply.run({
      input: {
        memoryId: 'a',
        requestId: 'oversized',
        expectedRevision: 2,
        commands: [{ op: 'add', content: 'x'.repeat(20) }],
      },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', commit: { status: 'not-committed' } });
  expect(store.commits).toBe(2);
  expect(await store.getReceipt('a', 'oversized')).toBeUndefined();
  sqlite.close();
  expect(database.isOpen).toBe(true);
});
