import type { ProviderModelReference } from '@print-an-agent/model-invocation-core';
import type { PreparedHttpEmbeddingConfig } from './types.js';
import {
  defineProviderModelReference,
  EmbeddingError,
} from '@print-an-agent/model-invocation-core';

/** Adapter config is a data-only closed record, never an executable provider extension bag. */
export function readConfigRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Expected plain record');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error('Expected plain record');
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !keys.includes(key)) throw new Error('Unsupported field');
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (field === undefined || !field.enumerable || !('value' in field)) {
        throw new Error('Expected data property');
      }
      result[key] = field.value;
    }
    return result;
  } catch (cause: unknown) {
    throw new EmbeddingError('EMBEDDING_BINDING_INVALID', 'Invalid HTTP embedding configuration.', {
      cause,
    });
  }
}

export function prepareHttpEmbeddingConfig(config: unknown): PreparedHttpEmbeddingConfig {
  const record = readConfigRecord(config, [
    'endpoint',
    'provider',
    'model',
    'modelRef',
    'dimensions',
    'authentication',
    'limits',
    'maxResponseBytes',
    'sendDimensions',
  ]);
  const auth = readConfigRecord(record.authentication, ['kind', 'credentialRef']);
  if (
    (auth.kind !== 'keyless' && auth.kind !== 'credential-reference') ||
    (auth.kind === 'keyless' && Object.hasOwn(auth, 'credentialRef')) ||
    (auth.kind === 'credential-reference' && auth.credentialRef === undefined) ||
    typeof record.endpoint !== 'string' ||
    typeof record.sendDimensions !== 'boolean' ||
    typeof record.maxResponseBytes !== 'number' ||
    !Number.isSafeInteger(record.maxResponseBytes) ||
    record.maxResponseBytes < 1
  ) {
    throw new EmbeddingError('EMBEDDING_BINDING_INVALID', 'Invalid HTTP embedding configuration.');
  }
  let reference: ProviderModelReference;
  try {
    reference = defineProviderModelReference({
      provider: record.provider,
      model: record.model,
      baseUrl: record.endpoint,
      ...(auth.kind === 'keyless' ? {} : { credentialRef: auth.credentialRef }),
    });
  } catch (cause: unknown) {
    throw new EmbeddingError('EMBEDDING_BINDING_INVALID', 'Invalid HTTP embedding target.', {
      cause,
    });
  }
  return Object.freeze({
    target: Object.freeze({
      reference,
      endpoint: record.endpoint,
      maxResponseBytes: record.maxResponseBytes,
      sendDimensions: record.sendDimensions,
    }),
    representation: Object.freeze({ modelRef: record.modelRef, dimensions: record.dimensions }),
    limits: record.limits,
  });
}
