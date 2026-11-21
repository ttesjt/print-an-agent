import { bindCredentialResolver } from './authentication.js';
import {
  createTextEmbedder,
  EmbeddingError,
  type TextEmbeddingCapability,
  type TextEmbeddingRequest,
} from '@print-an-agent/model-invocation-core';
import {
  readConfigRecord,
  prepareHttpEmbeddingConfig,
  prepareHttpEmbeddingRepresentation,
} from './configuration/index.js';
import { requestHttpEmbeddings } from './http/index.js';
import type { CreateHttpTextEmbedderOptions } from './types.js';

function isFetch(input: unknown): input is typeof globalThis.fetch {
  return typeof input === 'function';
}

export function createHttpTextEmbedder(
  options: CreateHttpTextEmbedderOptions
): TextEmbeddingCapability {
  const record = readConfigRecord(options, [
    'config',
    'credentialResolver',
    'fetch',
    'invocationPolicy',
  ]);
  // The public config is checked as unknown; Core validates its representation, limits and policy.
  const config = prepareHttpEmbeddingConfig(record.config);
  const resolver = bindCredentialResolver(record.credentialResolver);
  const fetchImplementation = record.fetch === undefined ? globalThis.fetch : record.fetch;
  if (!isFetch(fetchImplementation)) {
    throw new EmbeddingError(
      'EMBEDDING_BINDING_INVALID',
      'Embedding fetch implementation is invalid.'
    );
  }
  if (config.target.reference.credentialRef !== undefined && resolver === undefined) {
    throw new EmbeddingError(
      'EMBEDDING_BINDING_INVALID',
      'Embedding authentication requires a resolver.'
    );
  }
  // Only Core can turn this unchecked adapter configuration into a validated binding.
  const definition = {
    representation: prepareHttpEmbeddingRepresentation(config),
    limits: config.limits,
    ...(record.invocationPolicy === undefined ? {} : { invocationPolicy: record.invocationPolicy }),
    embed(request: TextEmbeddingRequest) {
      return requestHttpEmbeddings(
        {
          ...config.target,
          // Core has returned before any invocation can read its frozen descriptor.
          dimensions: capability.descriptor.representation.dimensions,
          credentialResolver: resolver,
          fetch: fetchImplementation,
        },
        request
      );
    },
  };
  const capability: TextEmbeddingCapability = createTextEmbedder(definition);
  return capability;
}
