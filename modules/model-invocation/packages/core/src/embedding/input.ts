import { Buffer } from 'node:buffer';
import { EMBEDDING_TASK } from './tasks.js';
import { type TextEmbeddingDescriptor } from './types/descriptor.js';
import { type TextEmbeddingInput, type TextEmbeddingRequest } from './types/invocation.js';
import { EmbeddingError } from './errors.js';
import {
  readEmbeddingArray,
  readEmbeddingArrayLength,
  readEmbeddingRecord,
  readEmbeddingReference,
} from './validation.js';

export function parseTextEmbeddingRequest(
  input: unknown,
  descriptor: TextEmbeddingDescriptor
): TextEmbeddingRequest {
  const code = 'EMBEDDING_INPUT_INVALID';
  const record = readEmbeddingRecord(input, ['task', 'inputs', 'signal'], code);
  if (record.task !== EMBEDDING_TASK.DOCUMENT && record.task !== EMBEDDING_TASK.QUERY) {
    throw new EmbeddingError(code, 'Embedding task must be document or query.');
  }
  const signal = parseEmbeddingSignal(record.signal);
  const count = readEmbeddingArrayLength(record.inputs, code);
  if (count === 0) throw new EmbeddingError(code, 'Embedding inputs cannot be empty.');
  assertLimit(count, descriptor.limits.maxBatchSize);
  const entries = readEmbeddingArray(record.inputs, code, count);
  let totalBytes = 0;
  const identifiers = new Set<string>();
  const inputs: TextEmbeddingInput[] = entries.map((entry) => {
    const item = readEmbeddingRecord(entry, ['id', 'text'], code);
    const id = readEmbeddingReference(item.id, code);
    if (identifiers.has(id)) throw new EmbeddingError(code, 'Embedding input IDs must be unique.');
    identifiers.add(id);
    if (typeof item.text !== 'string' || !item.text.isWellFormed()) {
      throw new EmbeddingError(code, 'Embedding text must contain well-formed Unicode.');
    }
    const bytes = Buffer.byteLength(item.text, 'utf8');
    assertLimit(bytes, descriptor.limits.maxInputUtf8Bytes);
    totalBytes += bytes;
    assertLimit(totalBytes, descriptor.limits.maxBatchUtf8Bytes);
    return Object.freeze({ id, text: item.text });
  });
  return Object.freeze({ task: record.task, inputs: Object.freeze(inputs), signal });
}

function parseEmbeddingSignal(input: unknown): AbortSignal {
  const code = 'EMBEDDING_INPUT_INVALID';
  try {
    if (!(input instanceof AbortSignal)) throw new Error('Expected an AbortSignal');
    // Prototype inheritance alone does not establish the runtime's AbortSignal brand.
    Reflect.get(AbortSignal.prototype, 'aborted', input);
    return input;
  } catch (cause: unknown) {
    throw new EmbeddingError(code, 'Embedding invocation requires a genuine AbortSignal.', {
      cause,
    });
  }
}

function assertLimit(actual: number, limit: number | null): void {
  if (!Number.isSafeInteger(actual) || (limit !== null && actual > limit)) {
    throw new EmbeddingError('EMBEDDING_INPUT_LIMIT_EXCEEDED', 'Embedding input exceeds a limit.');
  }
}
