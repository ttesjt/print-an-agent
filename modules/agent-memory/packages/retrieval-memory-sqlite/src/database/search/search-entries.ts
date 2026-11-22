import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  assertCanonicalVector,
  canonical,
  identifier,
  jsonSnapshot,
  parseMetadataFilter,
  DEFAULT_RETRIEVAL_POLICY,
  RetrievalMemoryError,
  type BackendSearch,
  type SearchResult,
} from '@print-an-agent/retrieval-memory';
import { requireStoredSpace } from '../persistence/index.js';
import { vectorTable } from '../vector-index.js';
import { SQLITE_RETRIEVAL_LIMITS, assertSqliteLimit } from '../../capabilities.js';
import { transaction } from '../transaction.js';
import { encodeVector } from '../vector-codec.js';
import { compileMetadataFilter } from './filter-sql.js';
import { mapHits } from './map-hits.js';
export function searchEntries(
  db: DatabaseSync,
  input: BackendSearch,
  flag: Int32Array
): SearchResult {
  jsonSnapshot(input);
  identifier(input.space.memoryId);
  assertSqliteLimit(input.topK, SQLITE_RETRIEVAL_LIMITS.maxTopK);
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
      ${eligibility === undefined ? '' : `AND v.row_id IN (SELECT row_id FROM rm_chunks WHERE memory_id=? AND entry_id IN (SELECT entry_id FROM rm_entries e2 INDEXED BY rm_metadata_scan WHERE memory_id=? AND ${eligibility.sql}))`}
      ORDER BY v.distance`;
    const params: SQLInputValue[] = [
      encodeVector(input.vector),
      input.topK,
      space.memoryId,
      space.index.generationId,
    ];
    if (eligibility !== undefined)
      params.push(space.memoryId, space.memoryId, ...eligibility.parameters);
    const rows = db.prepare(sql).all(...params);
    const hits = mapHits(rows, space);
    return { space, hits };
  });
}
