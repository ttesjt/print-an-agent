import type {
  ProviderCredentialResolver,
  TextEmbeddingInvocationPolicy,
} from '@print-an-agent/model-invocation-core';
import type { HttpTextEmbeddingConfig } from './configuration/index.js';

export interface CreateHttpTextEmbedderOptions {
  readonly config: HttpTextEmbeddingConfig;
  readonly credentialResolver?: ProviderCredentialResolver;
  /** Borrowed fetch implementation; never closed by this adapter. Must honor request.signal. */
  readonly fetch?: typeof globalThis.fetch;
  readonly invocationPolicy?: TextEmbeddingInvocationPolicy;
}
