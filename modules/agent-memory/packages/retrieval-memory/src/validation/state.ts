import type {
  EntryRepresentation,
  RetrievalChunk,
  RetrievalEntry,
  RetrievalSpace,
  StoredEntry,
} from '../contracts/data.js';
import { COSINE_METRIC_REF, assertCanonicalVector } from '../representation/metric.js';
import { exact, identifier, integer, record, text } from './json.js';
import { entryBody } from './input.js';
import { DEFAULT_RETRIEVAL_POLICY } from '../config.js';
import { fail } from '../errors.js';
export function parseRetrievalSpace(value: unknown): RetrievalSpace {
  const data = record(value);
  exact(data, ['memoryId', 'revision', 'sequence', 'index']);
  const index = record(data.index);
  exact(index, ['generationId', 'embeddingRef', 'chunkerRef', 'metricRef', 'dimensions']);
  if (index.metricRef !== COSINE_METRIC_REF)
    fail('UNSUPPORTED_CAPABILITY', 'Unsupported retrieval metric.');
  return {
    memoryId: identifier(data.memoryId),
    revision: integer(data.revision),
    sequence: integer(data.sequence, 0),
    index: {
      generationId: identifier(index.generationId),
      embeddingRef: identifier(index.embeddingRef),
      chunkerRef: identifier(index.chunkerRef),
      metricRef: COSINE_METRIC_REF,
      dimensions: integer(index.dimensions),
    },
  };
}
export function parseRetrievalEntry(value: unknown): RetrievalEntry {
  const data = record(value);
  exact(data, ['memoryId', 'entryId', 'revision', 'content', 'metadata', 'source']);
  return {
    memoryId: identifier(data.memoryId),
    entryId: identifier(data.entryId),
    revision: integer(data.revision),
    ...entryBody(data, { ...DEFAULT_RETRIEVAL_POLICY, maxEntryCodepoints: null }),
  };
}
export function validateRepresentation(
  value: EntryRepresentation,
  entry: RetrievalEntry,
  space: RetrievalSpace
): EntryRepresentation {
  const copy = parseRepresentation(value);
  if (
    copy.embeddingRef !== space.index.embeddingRef ||
    copy.chunkerRef !== space.index.chunkerRef ||
    copy.metricRef !== space.index.metricRef ||
    copy.chunks.length === 0
  )
    fail('REPRESENTATION_INVALID', 'Representation configuration does not match its Space.');
  identifier(copy.representationId);
  const ids = new Set<string>();
  copy.chunks.forEach((chunk, ordinal) => {
    identifier(chunk.chunkId);
    text(chunk.text, true);
    if (
      ids.has(chunk.chunkId) ||
      chunk.ordinal !== ordinal ||
      chunk.memoryId !== entry.memoryId ||
      chunk.entryId !== entry.entryId ||
      chunk.entryRevision !== entry.revision ||
      chunk.generationId !== space.index.generationId ||
      chunk.representationId !== copy.representationId
    )
      fail('REPRESENTATION_INVALID', 'Chunk scope or evidence is invalid.');
    ids.add(chunk.chunkId);
    if (chunk.span !== null) {
      const start = integer(chunk.span.start, 0);
      const end = integer(chunk.span.end);
      if (
        end <= start ||
        end > entry.content.length ||
        entry.content.slice(start, end) !== chunk.text
      )
        fail('REPRESENTATION_INVALID', 'Chunk source span is invalid.');
    }
    assertCanonicalVector(chunk.vector, space.index.dimensions);
  });
  return copy;
}
function parseRepresentation(value: unknown): EntryRepresentation {
  const data = record(value);
  exact(data, ['representationId', 'embeddingRef', 'chunkerRef', 'metricRef', 'chunks']);
  if (!Array.isArray(data.chunks))
    fail('REPRESENTATION_INVALID', 'Expected representation chunks.');
  const chunks: RetrievalChunk[] = data.chunks.map((value) => {
    const chunk = record(value);
    exact(chunk, [
      'memoryId',
      'entryId',
      'entryRevision',
      'generationId',
      'representationId',
      'chunkId',
      'ordinal',
      'text',
      'span',
      'vector',
    ]);
    if (!Array.isArray(chunk.vector)) fail('REPRESENTATION_INVALID', 'Expected a numeric vector.');
    const vector = chunk.vector.map((value) => {
      if (typeof value !== 'number') fail('REPRESENTATION_INVALID', 'Expected numeric components.');
      return value;
    });
    const span =
      chunk.span === null
        ? null
        : (() => {
            const span = record(chunk.span);
            exact(span, ['start', 'end']);
            return { start: integer(span.start, 0), end: integer(span.end) };
          })();
    return {
      memoryId: identifier(chunk.memoryId),
      entryId: identifier(chunk.entryId),
      entryRevision: integer(chunk.entryRevision),
      generationId: identifier(chunk.generationId),
      representationId: identifier(chunk.representationId),
      chunkId: identifier(chunk.chunkId),
      ordinal: integer(chunk.ordinal, 0),
      text: text(chunk.text, true),
      span,
      vector,
    };
  });
  return {
    representationId: identifier(data.representationId),
    embeddingRef: identifier(data.embeddingRef),
    chunkerRef: identifier(data.chunkerRef),
    metricRef: identifier(data.metricRef),
    chunks,
  };
}
export function parseStoredEntry(value: unknown, space: RetrievalSpace): StoredEntry {
  const data = record(value);
  exact(data, ['entry', 'representation']);
  const entry = parseRetrievalEntry(data.entry);
  if (entry.memoryId !== space.memoryId)
    fail('REPRESENTATION_INVALID', 'Stored Entry scope mismatch.');
  // Validate the structural record before using the typed representation's numerical guard.
  const representation = parseRepresentation(data.representation);
  return { entry, representation: validateRepresentation(representation, entry, space) };
}
