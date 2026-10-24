import type { DatabaseSync } from 'node:sqlite';
import {
  validatePublication,
  assertReceiptMatches,
  decideRetrievalPublication,
  RetrievalMemoryError,
  type RetrievalPublication,
  type RetrievalReceipt,
} from '@ta-agent/retrieval-memory';
import { vectorTable, ensureVectorTable } from './schema.js';
import { encode, readEntry, readReceipt, readSpace } from './records.js';
import { transaction } from './transaction.js';
export function publish(
  db: DatabaseSync,
  input: RetrievalPublication,
  flag: Int32Array
): RetrievalReceipt {
  const candidate = validatePublication(input);
  const { mutation, space } = candidate;
  const { memoryId, requestId } = mutation.input;
  let recovered: RetrievalReceipt | undefined;
  try {
    return transaction(db, 'write', flag, () => {
      const receipt = readReceipt(db, memoryId, requestId);
      if (receipt !== undefined) {
        assertReceiptMatches(receipt, mutation);
        recovered = receipt;
        return receipt;
      }
      const currentSpace = readSpace(db, memoryId);
      const entryId =
        candidate.entry?.entryId ?? ('entryId' in mutation.input ? mutation.input.entryId : null);
      const current = entryId === null ? undefined : readEntry(db, memoryId, entryId, currentSpace);
      const decision = decideRetrievalPublication(currentSpace, current, receipt, candidate);
      if (!('space' in decision)) {
        recovered = decision.receipt;
        return recovered;
      }
      ensureVectorTable(db, space.index.dimensions);
      db.prepare(
        'INSERT INTO rm_spaces VALUES(?,?) ON CONFLICT(memory_id) DO UPDATE SET payload=excluded.payload'
      ).run(memoryId, encode(decision.space));
      if (entryId !== null && decision.receipt.outcome !== 'unchanged') {
        const table = vectorTable(space.index.dimensions);
        const rows = db
          .prepare('SELECT row_id FROM rm_chunks WHERE memory_id=? AND entry_id=?')
          .all(memoryId, entryId);
        for (const row of rows)
          db.prepare(`DELETE FROM ${table} WHERE row_id=?`).run(BigInt(String(row.row_id)));
        db.prepare('DELETE FROM rm_entries WHERE memory_id=? AND entry_id=?').run(
          memoryId,
          entryId
        );
        if (decision.stored !== null) {
          const { entry, representation } = decision.stored;
          const { chunks, ...header } = representation;
          db.prepare('INSERT INTO rm_entries VALUES(?,?,?,?,?)').run(
            memoryId,
            entryId,
            encode(entry),
            encode(header),
            encode(entry.metadata)
          );
          const chunkInsert = db.prepare(
            'INSERT INTO rm_chunks(memory_id,entry_id,chunk_json,vector) VALUES(?,?,?,?)'
          );
          const vectorInsert = db.prepare(
            `INSERT INTO ${table}(row_id,embedding,memory_id,generation_id) VALUES(?,?,?,?)`
          );
          for (const { vector, ...chunk } of chunks) {
            const binary = new Float32Array(vector);
            const result = chunkInsert.run(memoryId, entryId, encode(chunk), binary);
            vectorInsert.run(
              BigInt(result.lastInsertRowid),
              binary,
              memoryId,
              space.index.generationId
            );
          }
        }
      }
      db.prepare('INSERT INTO rm_receipts VALUES(?,?,?)').run(
        memoryId,
        requestId,
        encode(decision.receipt)
      );
      return decision.receipt;
    });
  } catch (cause) {
    if (recovered !== undefined) {
      if (cause instanceof RetrievalMemoryError && cause.code === 'OPERATION_ABORTED')
        return recovered;
      throw new RetrievalMemoryError(
        cause instanceof RetrievalMemoryError ? cause.code : 'STORAGE_FAILED',
        'Receipt recovered, but transaction cleanup failed.',
        { cause, commit: { status: 'committed', receipt: recovered } }
      );
    }
    if (
      cause instanceof RetrievalMemoryError &&
      (cause.code === 'COMMIT_UNKNOWN' ||
        cause.code === 'CLEANUP_FAILED' ||
        cause.commit?.status === 'unknown')
    )
      throw new RetrievalMemoryError(cause.code, cause.message, {
        cause,
        commit: { status: 'unknown', memoryId, requestId },
      });
    throw cause;
  }
}
