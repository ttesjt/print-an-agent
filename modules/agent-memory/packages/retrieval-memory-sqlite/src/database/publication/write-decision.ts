import type { DatabaseSync } from 'node:sqlite';
import type { PublicationDecision, RetrievalSpace } from '@print-an-agent/retrieval-memory';
import { ensureVectorTable, removeVectors, createVectorInsert } from '../vector-index.js';
import { encodeVector } from '../vector-codec.js';
import {
  writeSpace,
  entryChunkRowIds,
  deleteEntry,
  writeEntryHeader,
  createChunkInsert,
  writeReceipt,
} from '../persistence/index.js';

/** All writes use the caller's one synchronous publication transaction. */
export function writeDecision(
  db: DatabaseSync,
  space: RetrievalSpace,
  entryId: string | null,
  decision: PublicationDecision
): void {
  const { memoryId } = space;
  ensureVectorTable(db, space.index.dimensions);
  writeSpace(db, decision.space);
  if (entryId !== null && decision.receipt.outcome !== 'unchanged') {
    removeVectors(db, space.index.dimensions, entryChunkRowIds(db, memoryId, entryId));
    deleteEntry(db, memoryId, entryId);
    if (decision.stored !== null) {
      const { entry, representation } = decision.stored;
      const { chunks, ...header } = representation;
      writeEntryHeader(db, entry, header);
      const insertChunk = createChunkInsert(db, memoryId, entryId);
      const insertVector = createVectorInsert(db, space);
      for (const { vector, ...chunk } of chunks) {
        const binary = encodeVector(vector);
        insertVector(insertChunk(chunk, binary), binary);
      }
    }
  }
  writeReceipt(db, decision.receipt);
}
