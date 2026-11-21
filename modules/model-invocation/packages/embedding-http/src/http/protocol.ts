import type { HttpTextEmbeddingConfig } from '../configuration/index.js';
import {
  EmbeddingError,
  type TextEmbeddingRequest,
  type TextEmbeddingInput,
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

export function validateHttpEmbeddingInputs(inputs: readonly TextEmbeddingInput[]): void {
  if (inputs.some(({ text }) => text.length === 0)) {
    throw new EmbeddingError(
      'EMBEDDING_INPUT_INVALID',
      'HTTP embedding inputs cannot be empty strings.'
    );
  }
}

export function encodeEmbeddingRequest(
  options: Pick<HttpTextEmbeddingConfig, 'model' | 'sendDimensions' | 'dimensions'>,
  inputs: readonly TextEmbeddingInput[]
): string {
  return JSON.stringify({
    model: options.model,
    input: inputs.map(({ text }) => text),
    encoding_format: 'float',
    ...(options.sendDimensions ? { dimensions: options.dimensions } : {}),
  });
}
