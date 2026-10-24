import {
  createTextEmbedder,
  EmbeddingError,
  type ProviderCredentialResolver,
  type TextEmbeddingCapability,
  type TextEmbeddingRequest,
} from '@ta-agent/model-invocation-core';
import { readConfigRecord, prepareHttpEmbeddingConfig } from './config.js';
import { requestHttpEmbeddings } from './transport.js';
import type { CreateHttpTextEmbedderOptions } from './types.js';

const HTTP_EMBEDDING_RECIPE_REF = Object.freeze({
  MODEL_DEFAULT_DIMENSIONS: 'openai-compatible:float:model-default-dimensions',
  EXPLICIT_DIMENSIONS: 'openai-compatible:float:explicit-dimensions',
});

function bindCredentialResolver(input: unknown): ProviderCredentialResolver | undefined {
  if (input === undefined) return undefined;
  try {
    if (!isCredentialResolver(input)) throw new Error('Expected a credential resolver');
    const resolve = input.resolve.bind(input);
    return { resolve: (request) => resolve(request) };
  } catch (cause: unknown) {
    throw new EmbeddingError(
      'EMBEDDING_BINDING_INVALID',
      'Embedding credential resolver is invalid.',
      { cause }
    );
  }
}

function isCredentialResolver(input: unknown): input is ProviderCredentialResolver {
  return (
    typeof input === 'object' &&
    input !== null &&
    'resolve' in input &&
    typeof input.resolve === 'function'
  );
}

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
  if (config.reference.credentialRef !== undefined && resolver === undefined) {
    throw new EmbeddingError(
      'EMBEDDING_BINDING_INVALID',
      'Embedding authentication requires a resolver.'
    );
  }
  // Only Core can turn this unchecked adapter configuration into a validated binding.
  const recipeRef = config.sendDimensions
    ? HTTP_EMBEDDING_RECIPE_REF.EXPLICIT_DIMENSIONS
    : HTTP_EMBEDDING_RECIPE_REF.MODEL_DEFAULT_DIMENSIONS;
  const representation = {
    modelRef: config.modelRef,
    dimensions: config.dimensions,
    preprocessingRef: 'unicode-text:identity',
    documentRecipeRef: recipeRef,
    queryRecipeRef: recipeRef,
    outputTransformRef: 'provider-numbers:identity',
  };
  const definition = {
    representation,
    limits: config.limits,
    ...(record.invocationPolicy === undefined ? {} : { invocationPolicy: record.invocationPolicy }),
    embed(request: TextEmbeddingRequest) {
      return requestHttpEmbeddings(
        { config, credentialResolver: resolver, fetch: fetchImplementation },
        request
      );
    },
  };
  return createTextEmbedder(definition);
}
