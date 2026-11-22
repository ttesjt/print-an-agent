import { matchesSourceSpan } from './chunking/index.js';
import type { EntryRepresentation, RetrievalChunk } from '../types/representation.js';
import type { RetrievalEntry } from '../types/entry.js';
import type { RetrievalSpace } from '../types/space.js';
import { assertCanonicalVector } from './metric.js';
import { exact, identifier, integer, record, text } from '../values/index.js';
import { fail } from '../errors.js';

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
      if (!matchesSourceSpan(entry.content, chunk.text, { start, end }))
        fail('REPRESENTATION_INVALID', 'Chunk source span is invalid.');
    }
    assertCanonicalVector(chunk.vector, space.index.dimensions);
  });
  return copy;
}

export function parseRepresentation(value: unknown): EntryRepresentation {
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
