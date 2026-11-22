import type { SQLOutputValue } from 'node:sqlite';
import {
  jsonSnapshot,
  parseRetrievalEntry,
  RetrievalMemoryError,
  type RetrievalChunk,
  type RetrievalHit,
  type RetrievalSpace,
} from '@print-an-agent/retrieval-memory';

const SQLITE_KNN_STRATEGY_REF = 'sqlite-vec:exhaustive-knn:v1';

// Check the physical JSON header's shape, not domain policy. The adapter persists vectors separately.
function decodeChunkHeader(json: string): Omit<RetrievalChunk, 'vector'> {
  const value = jsonSnapshot(JSON.parse(json));
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('memoryId' in value) ||
    typeof value.memoryId !== 'string' ||
    !('entryId' in value) ||
    typeof value.entryId !== 'string' ||
    !('entryRevision' in value) ||
    typeof value.entryRevision !== 'number' ||
    !('generationId' in value) ||
    typeof value.generationId !== 'string' ||
    !('representationId' in value) ||
    typeof value.representationId !== 'string' ||
    !('chunkId' in value) ||
    typeof value.chunkId !== 'string' ||
    !('ordinal' in value) ||
    typeof value.ordinal !== 'number' ||
    !('text' in value) ||
    typeof value.text !== 'string' ||
    !('span' in value)
  )
    throw new RetrievalMemoryError('SEARCH_FAILED', 'Invalid persisted search result.');
  // Construct from narrowed fields so assertions do not stand in for storage decoding.
  return {
    ...value,
    memoryId: value.memoryId,
    entryId: value.entryId,
    entryRevision: value.entryRevision,
    generationId: value.generationId,
    representationId: value.representationId,
    chunkId: value.chunkId,
    ordinal: value.ordinal,
    text: value.text,
    span: decodeSpan(value.span),
  };
}

function decodeSpan(value: unknown): RetrievalChunk['span'] {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('start' in value) ||
    typeof value.start !== 'number' ||
    !('end' in value) ||
    typeof value.end !== 'number'
  )
    throw new RetrievalMemoryError('SEARCH_FAILED', 'Invalid persisted search result.');
  return { ...value, start: value.start, end: value.end };
}

export function mapHits(
  rows: readonly Record<string, SQLOutputValue>[],
  space: RetrievalSpace
): RetrievalHit[] {
  const hits: RetrievalHit[] = rows.map((row) => {
    if (
      typeof row.distance !== 'number' ||
      !Number.isFinite(row.distance) ||
      typeof row.chunk_json !== 'string' ||
      typeof row.entry_json !== 'string'
    )
      throw new RetrievalMemoryError('SEARCH_FAILED', 'Invalid persisted search result.');
    const chunk = decodeChunkHeader(row.chunk_json);
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
        strategyRef: SQLITE_KNN_STRATEGY_REF,
      },
    };
  });
  hits.sort(
    (a, b) =>
      a.ranking.value - b.ranking.value ||
      Buffer.compare(Buffer.from(a.entryId), Buffer.from(b.entryId)) ||
      a.ordinal - b.ordinal
  );
  return hits;
}
