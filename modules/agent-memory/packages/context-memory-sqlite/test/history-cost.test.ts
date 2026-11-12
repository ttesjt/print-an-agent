import { DatabaseSync } from 'node:sqlite';
import { stat } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { canonicalJson, jsonValue } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { borrowed, domain, fileStores } from './support/fixtures.js';

function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Expected numeric SQLite aggregate.');
  return value;
}

it.each(['small-edits', 'long-paragraph', 'global-rewrite'] as const)(
  'measures actual storage and bounded recovery for %s',
  async (workload) => {
    const { path, register } = await fileStores();
    const store = new SqliteMemoryStore({ path, history: { maxDeltaChain: 16 } });
    register(store);
    const { database } = borrowed(new DatabaseSync(path));
    const { mutations } = domain(store);
    const iterations = workload === 'global-rewrite' ? 32 : 128;
    const items = Array.from({ length: workload === 'long-paragraph' ? 1 : 24 }, (_, index) => ({
      content:
        workload === 'long-paragraph'
          ? 'paragraph '.repeat(2400)
          : ('entry-' + index + ' ').repeat(100),
      metadata: { category: 'qualification', index },
    }));
    await mutations.create({
      memoryId: 'cost',
      requestId: 'create',
      items,
      config: { maxContextTokens: null },
    });
    const initial = (await store.read('cost'))!;
    let fullSnapshotBytes = Buffer.byteLength(canonicalJson(jsonValue(initial)));
    const started = performance.now();
    for (let index = 1; index <= iterations; index++) {
      const selected =
        workload === 'global-rewrite'
          ? initial.items
          : [initial.items[index % initial.items.length]!];
      await mutations.apply({
        memoryId: 'cost',
        requestId: String(index),
        expectedRevision: index,
        commands: selected.map((item) => ({
          op: 'replace',
          itemId: item.id,
          content:
            workload === 'global-rewrite'
              ? String.fromCharCode(65 + (index % 26)).repeat(1200) + index
              : item.content + String(index),
          ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
        })),
      });
      fullSnapshotBytes += Buffer.byteLength(canonicalJson(jsonValue((await store.read('cost'))!)));
    }
    const writeMs = performance.now() - started;
    const readStarted = performance.now();
    for (const revision of [1, 2, 17, Math.floor(iterations / 2), iterations + 1])
      expect((await store.readVersion({ memoryId: 'cost', revision }))?.revision).toBe(revision);
    const history = database
      .prepare(
        "SELECT count(*) AS versions, sum(length(CAST(payload_json AS BLOB))) AS bytes, max(depth) AS depth, sum(kind = 'base') AS bases, sum(kind = 'delta') AS deltas FROM context_memory_history"
      )
      .get()!;
    const receiptBytes = numeric(
      database
        .prepare(
          'SELECT sum(length(CAST(receipt_json AS BLOB))) AS bytes FROM context_memory_receipts'
        )
        .get()?.bytes
    );
    const headBytes = numeric(
      database
        .prepare(
          'SELECT sum(length(CAST(snapshot_json AS BLOB))) AS bytes FROM context_memory_documents'
        )
        .get()?.bytes
    );
    const payloadBytes = numeric(history.bytes);
    expect(history.versions).toBe(iterations + 1);
    expect(numeric(history.depth)).toBeLessThanOrEqual(16);
    if (workload !== 'global-rewrite') {
      expect(numeric(history.deltas)).toBeGreaterThan(iterations / 2);
      expect(payloadBytes).toBeLessThan(fullSnapshotBytes * 0.5);
    }
    const fileBytes = (await stat(path)).size;
    console.info(
      'Context Memory history cost',
      JSON.stringify({
        workload,
        versions: history.versions,
        bases: history.bases,
        deltas: history.deltas,
        maxDepth: history.depth,
        fullSnapshotBytes,
        payloadBytes,
        receiptBytes,
        headBytes,
        fileBytes,
        writeMs: Math.round(writeMs),
        sampledReadMs: Math.round(performance.now() - readStarted),
      })
    );
  },
  30000
);
