import { createHash } from 'node:crypto';
import { EMBEDDING_TASK } from './tasks.js';
import {
  type TextEmbeddingDescriptor,
  type TextEmbeddingLimits,
  type TextEmbeddingRepresentation,
} from './types/descriptor.js';
import { readEmbeddingRecord, readEmbeddingReference, readPositiveInteger } from './validation.js';

const REPRESENTATION_KEYS = Object.freeze([
  'modelRef',
  'dimensions',
  'preprocessingRef',
  'documentRecipeRef',
  'queryRecipeRef',
  'outputTransformRef',
]);
const LIMIT_KEYS = Object.freeze(['maxBatchSize', 'maxInputUtf8Bytes', 'maxBatchUtf8Bytes']);

function parseRepresentation(input: unknown): TextEmbeddingRepresentation {
  const code = 'EMBEDDING_BINDING_INVALID';
  const record = readEmbeddingRecord(input, REPRESENTATION_KEYS, code);
  return Object.freeze({
    modelRef: readEmbeddingReference(record.modelRef, code),
    dimensions: readPositiveInteger(record.dimensions, code),
    preprocessingRef: readEmbeddingReference(record.preprocessingRef, code),
    documentRecipeRef: readEmbeddingReference(record.documentRecipeRef, code),
    queryRecipeRef: readEmbeddingReference(record.queryRecipeRef, code),
    outputTransformRef: readEmbeddingReference(record.outputTransformRef, code),
  });
}

function parseLimits(input: unknown): TextEmbeddingLimits {
  const code = 'EMBEDDING_BINDING_INVALID';
  const record = readEmbeddingRecord(input, LIMIT_KEYS, code);
  const limit = (value: unknown): number | null =>
    value === null ? null : readPositiveInteger(value, code);
  return Object.freeze({
    maxBatchSize: limit(record.maxBatchSize),
    maxInputUtf8Bytes: limit(record.maxInputUtf8Bytes),
    maxBatchUtf8Bytes: limit(record.maxBatchUtf8Bytes),
  });
}

export function createTextEmbeddingDescriptor(
  representationInput: unknown,
  limitsInput: unknown
): TextEmbeddingDescriptor {
  const representation = parseRepresentation(representationInput);
  const limits = parseLimits(limitsInput);
  // Fixed field order and domain separation make identity independent of object insertion order.
  const digest = createHash('sha256')
    .update('text-embedding-representation\0')
    .update(JSON.stringify(representation))
    .digest('hex');
  return Object.freeze({
    representationRef: `text-embedding:sha256:${digest}`,
    representation,
    inputKind: 'text',
    tasks: Object.freeze([EMBEDDING_TASK.DOCUMENT, EMBEDDING_TASK.QUERY]),
    limits,
  });
}
