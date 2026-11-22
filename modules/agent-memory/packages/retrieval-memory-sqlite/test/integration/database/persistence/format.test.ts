import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';

// Captured before the structural refactor, including its original cursor and binary vectors.
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/persisted-format.json', import.meta.url), 'utf8')
) as {
  schema: string[];
  spaces: { memory_id: string; payload: string }[];
  entries: {
    memory_id: string;
    entry_id: string;
    entry_json: string;
    representation_json: string;
    metadata_json: string;
  }[];
  chunks: {
    row_id: number;
    memory_id: string;
    entry_id: string;
    chunk_json: string;
    vector_hex: string;
  }[];
  receipts: { memory_id: string; request_id: string; payload: string }[];
  cursor: string;
};

it('reads pre-refactor records, float32 blobs, receipts and pagination cursors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retrieval-format-'));
  const path = join(directory, 'memory.db');
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec(fixture.schema.join(';'));
      for (const row of fixture.spaces)
        db.prepare('INSERT INTO rm_spaces VALUES(?,?)').run(row.memory_id, row.payload);
      for (const row of fixture.entries)
        db.prepare('INSERT INTO rm_entries VALUES(?,?,?,?,?)').run(
          row.memory_id,
          row.entry_id,
          row.entry_json,
          row.representation_json,
          row.metadata_json
        );
      for (const row of fixture.chunks)
        db.prepare('INSERT INTO rm_chunks VALUES(?,?,?,?,?)').run(
          row.row_id,
          row.memory_id,
          row.entry_id,
          row.chunk_json,
          Buffer.from(row.vector_hex, 'hex')
        );
      for (const row of fixture.receipts)
        db.prepare('INSERT INTO rm_receipts VALUES(?,?,?)').run(
          row.memory_id,
          row.request_id,
          row.payload
        );
    } finally {
      db.close();
    }
    const backend = await openSqliteRetrievalBackend({ path });
    try {
      for (const row of fixture.entries) {
        const stored = await backend.get(row.memory_id, row.entry_id);
        expect(stored?.entry).toEqual(JSON.parse(row.entry_json));
        expect(stored?.representation.chunks[0]?.vector).toEqual([1, 0, 0, 0]);
      }
      for (const row of fixture.receipts)
        expect(await backend.getReceipt(row.memory_id, row.request_id)).toEqual(
          JSON.parse(row.payload)
        );
      const first = await backend.list({ memoryId: 'format-space', limit: 1 });
      expect(first.nextCursor).toBe(fixture.cursor);
      const last = await backend.list({
        memoryId: 'format-space',
        limit: 10,
        cursor: fixture.cursor,
      });
      expect(last.entries.map((entry) => entry.entryId)).toEqual(
        fixture.entries.slice(1).map((entry) => entry.entry_id)
      );
      expect(last.nextCursor).toBeNull();
    } finally {
      await backend.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
