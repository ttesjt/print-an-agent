import type {
  TextEmbeddingDescriptor,
  TextEmbeddingRequest,
  TextEmbeddingResult,
  TextEmbeddingVector,
} from './contracts.js';
import { EmbeddingError } from './errors.js';
import { readEmbeddingArray, readEmbeddingRecord, readEmbeddingReference } from './validation.js';

export function normalizeTextEmbeddingResult(
  input: unknown,
  request: TextEmbeddingRequest,
  descriptor: TextEmbeddingDescriptor
): TextEmbeddingResult {
  const code = 'EMBEDDING_RESPONSE_INVALID';
  const entries = readEmbeddingArray(input, code, request.inputs.length);
  const expected = new Set(request.inputs.map((item) => item.id));
  const results = new Map<string, TextEmbeddingVector>();
  for (const entry of entries) {
    const record = readEmbeddingRecord(entry, ['id', 'vector'], code);
    const id = readEmbeddingReference(record.id, code);
    if (!expected.has(id) || results.has(id)) {
      throw new EmbeddingError(code, 'Embedding result IDs do not match the request.');
    }
    const vector = readEmbeddingArray(
      record.vector,
      code,
      descriptor.representation.dimensions
    ).map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new EmbeddingError(code, 'Embedding vectors must contain finite numbers.');
      }
      return value;
    });
    results.set(id, Object.freeze({ id, vector: Object.freeze(vector) }));
  }
  return Object.freeze({
    representationRef: descriptor.representationRef,
    task: request.task,
    embeddings: Object.freeze(
      request.inputs.map(({ id }) => {
        const result = results.get(id);
        if (result === undefined) throw new EmbeddingError(code, 'Embedding result is incomplete.');
        return result;
      })
    ),
  });
}
