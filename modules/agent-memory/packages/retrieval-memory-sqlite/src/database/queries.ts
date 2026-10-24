import type { DatabaseSync } from 'node:sqlite';
import {
  assertCanonicalVector,
  canonical,
  identifier,
  jsonSnapshot,
  parseMetadataFilter,
  DEFAULT_RETRIEVAL_POLICY,
  parseRetrievalEntry,
  RetrievalMemoryError,
  type BackendSearch,
  type EntryPage,
  type RetrievalHit,
  type RetrievalChunk,
  type SearchResult,
} from '@ta-agent/retrieval-memory';
import { requireStoredSpace } from './records.js';
import { SQLITE_RETRIEVAL_LIMITS, vectorTable } from './schema.js';
import { transaction } from './transaction.js';
import { compileMetadataFilter } from './filters.js';
function bound(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RetrievalMemoryError(
      'UNSUPPORTED_CAPABILITY',
      'Requested limit exceeds SQLite capability.'
    );
}
export function listEntries(
  db: DatabaseSync,
  input: { memoryId: string; limit: number; cursor?: string },
  flag: Int32Array
): EntryPage {
  identifier(input.memoryId);
  bound(input.limit, SQLITE_RETRIEVAL_LIMITS.maxListLimit);
  return transaction(db, 'read', flag, () => {
    const space = requireStoredSpace(db, input.memoryId);
    let after: string | null = null;
    if (input.cursor !== undefined) {
      let cursor: unknown;
      try {
        cursor = jsonSnapshot(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      } catch (cause) {
        throw new RetrievalMemoryError('INPUT_INVALID', 'Invalid pagination cursor.', { cause });
      }
      if (
        typeof cursor !== 'object' ||
        cursor === null ||
        !('memoryId' in cursor) ||
        !('sequence' in cursor) ||
        !('order' in cursor) ||
        !('after' in cursor) ||
        cursor.memoryId !== input.memoryId ||
        cursor.sequence !== space.sequence ||
        cursor.order !== 'entry-id-utf8-v1'
      )
        throw new RetrievalMemoryError('STALE_CURSOR', 'Cursor scope or published view changed.');
      after = identifier(cursor.after);
    }
    const rows = db
      .prepare(
        'SELECT entry_json FROM rm_entries WHERE memory_id=? AND (? IS NULL OR entry_id > ? COLLATE BINARY) ORDER BY entry_id COLLATE BINARY LIMIT ?'
      )
      .all(input.memoryId, after, after, input.limit + 1);
    const entries = rows.slice(0, input.limit).map((row) => {
      if (typeof row.entry_json !== 'string')
        throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid stored Entry.');
      const entry = parseRetrievalEntry(JSON.parse(row.entry_json));
      return {
        memoryId: entry.memoryId,
        entryId: entry.entryId,
        revision: entry.revision,
        metadata: entry.metadata,
        source: entry.source,
      };
    });
    const last = entries.at(-1);
    return {
      space,
      entries,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? Buffer.from(
              JSON.stringify({
                memoryId: space.memoryId,
                sequence: space.sequence,
                order: 'entry-id-utf8-v1',
                after: last.entryId,
              })
            ).toString('base64url')
          : null,
    };
  });
}
export function searchEntries(
  db: DatabaseSync,
  input: BackendSearch,
  flag: Int32Array
): SearchResult {
  jsonSnapshot(input);
  identifier(input.space.memoryId);
  bound(input.topK, SQLITE_RETRIEVAL_LIMITS.maxTopK);
  assertCanonicalVector(input.vector, input.space.index.dimensions);
  const filter =
    input.filter === undefined
      ? undefined
      : parseMetadataFilter(input.filter, {
          ...DEFAULT_RETRIEVAL_POLICY,
          maxFilterDepth: null,
          maxFilterLeaves: null,
        });
  return transaction(db, 'read', flag, () => {
    const space = requireStoredSpace(db, input.space.memoryId);
    if (
      space.revision !== input.space.revision ||
      canonical(space.index) !== canonical(input.space.index)
    )
      throw new RetrievalMemoryError(
        'REVISION_CONFLICT',
        'Space representation configuration changed.'
      );
    const table = vectorTable(space.index.dimensions);
    const eligibility = filter === undefined ? undefined : compileMetadataFilter(filter);
    // Eligibility participates in KNN itself. Never fetch global topK and discard mismatches afterwards.
    const sql = `SELECT v.distance,c.chunk_json,e.entry_json FROM ${table} v
      JOIN rm_chunks c ON c.row_id=v.row_id JOIN rm_entries e ON e.memory_id=c.memory_id AND e.entry_id=c.entry_id
      WHERE v.embedding MATCH ? AND k=? AND v.memory_id=? AND v.generation_id=?
      ${filter === undefined ? '' : `AND v.row_id IN (SELECT row_id FROM rm_chunks WHERE memory_id=? AND entry_id IN (SELECT entry_id FROM rm_entries e2 INDEXED BY rm_metadata_scan WHERE memory_id=? AND ${eligibility!.sql}))`}
      ORDER BY v.distance`;
    const params = [
      new Float32Array(input.vector),
      input.topK,
      space.memoryId,
      space.index.generationId,
    ];
    const rows =
      filter === undefined
        ? db.prepare(sql).all(...params)
        : db
            .prepare(sql)
            .all(...params, space.memoryId, space.memoryId, ...eligibility!.parameters);
    const hits: RetrievalHit[] = rows.map((row) => {
      if (
        typeof row.distance !== 'number' ||
        !Number.isFinite(row.distance) ||
        typeof row.chunk_json !== 'string' ||
        typeof row.entry_json !== 'string'
      )
        throw new RetrievalMemoryError('SEARCH_FAILED', 'Invalid persisted search result.');
      const chunk = JSON.parse(row.chunk_json) as Omit<RetrievalChunk, 'vector'>;
      jsonSnapshot(chunk);
      const entry = parseRetrievalEntry(JSON.parse(row.entry_json));
      if (
        chunk.memoryId !== space.memoryId ||
        chunk.entryId !== entry.entryId ||
        chunk.entryRevision !== entry.revision ||
        chunk.generationId !== space.index.generationId
      )
        throw new RetrievalMemoryError('SEARCH_FAILED', 'Search evidence mismatch.');
      return {
        ...chunk,
        source: entry.source,
        ranking: {
          metricRef: space.index.metricRef,
          value: row.distance,
          order: 'ascending',
          strategyRef: 'sqlite-vec:exhaustive-knn:v1',
        },
      };
    });
    hits.sort(
      (a, b) =>
        a.ranking.value - b.ranking.value ||
        Buffer.compare(Buffer.from(a.entryId), Buffer.from(b.entryId)) ||
        a.ordinal - b.ordinal
    );
    return { space, hits };
  });
}
