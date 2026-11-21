import type {
  TextEmbedderDefinition,
  TextEmbeddingCapability,
  TextEmbeddingRequest,
} from './types/invocation.js';
import { createTextEmbeddingDescriptor } from './descriptor.js';
import { EmbeddingError } from './errors.js';
import { parseTextEmbeddingRequest } from './input.js';
import { parseEmbeddingInvocationPolicy } from './invocation-policy.js';
import { runEmbeddingInvocation } from './invocation.js';
import { normalizeTextEmbeddingResult } from './result.js';
import { readEmbeddingRecord } from './validation.js';

export function createTextEmbedder(definition: TextEmbedderDefinition): TextEmbeddingCapability;
export function createTextEmbedder(definition: unknown): TextEmbeddingCapability;
export function createTextEmbedder(definition: unknown): TextEmbeddingCapability {
  const code = 'EMBEDDING_BINDING_INVALID';
  const record = readEmbeddingRecord(
    definition,
    ['representation', 'limits', 'invocationPolicy', 'embed'],
    code
  );
  const implementation = record.embed;
  if (typeof implementation !== 'function') {
    throw new EmbeddingError(code, 'Embedding binding requires an implementation.');
  }
  const descriptor = createTextEmbeddingDescriptor(record.representation, record.limits);
  const policy = parseEmbeddingInvocationPolicy(record.invocationPolicy);
  return Object.freeze({
    descriptor,
    async embed(input: TextEmbeddingRequest) {
      const request = parseTextEmbeddingRequest(input, descriptor);
      return runEmbeddingInvocation(request.signal, policy, async (signal) => {
        const effectiveRequest = Object.freeze({ ...request, signal });
        const result: unknown = await Reflect.apply(implementation, definition, [effectiveRequest]);
        signal.throwIfAborted();
        return normalizeTextEmbeddingResult(result, effectiveRequest, descriptor);
      });
    },
  });
}
