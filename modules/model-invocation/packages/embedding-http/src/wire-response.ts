import {
  EmbeddingError,
  type TextEmbeddingRequest,
  type TextEmbeddingVector,
} from '@print-an-agent/model-invocation-core';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** JSON wire extensions are ignored; authoritative correspondence comes only from validated indices. */
export function decodeEmbeddingResponse(
  input: unknown,
  request: TextEmbeddingRequest,
  model: string
): readonly TextEmbeddingVector[] {
  if (
    !isRecord(input) ||
    input.object !== 'list' ||
    input.model !== model ||
    !Array.isArray(input.data) ||
    input.data.length !== request.inputs.length
  )
    throw invalidResponse();
  const seen = new Set<number>();
  return input.data.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      entry.object !== 'embedding' ||
      typeof entry.index !== 'number' ||
      !Number.isSafeInteger(entry.index) ||
      entry.index < 0 ||
      seen.has(entry.index) ||
      !Array.isArray(entry.embedding)
    )
      throw invalidResponse();
    const original = request.inputs[entry.index];
    if (original === undefined) throw invalidResponse();
    seen.add(entry.index);
    const vector = entry.embedding.map((value: unknown) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidResponse();
      return value;
    });
    return { id: original.id, vector };
  });
}

function invalidResponse(): EmbeddingError {
  return new EmbeddingError(
    'EMBEDDING_RESPONSE_INVALID',
    'Embedding endpoint returned an invalid batch.'
  );
}
