import type {
  ProviderCredentialResolver,
  TextEmbeddingInvocationPolicy,
  TextEmbeddingLimits,
} from '@ta-agent/model-invocation-core';

export type HttpEmbeddingAuthentication =
  | Readonly<{ kind: 'keyless' }>
  | Readonly<{ kind: 'credential-reference'; credentialRef: string }>;

export interface HttpTextEmbeddingConfig {
  /** Exact embeddings URL, not a base URL to which a guessed path is appended. */
  readonly endpoint: string;
  readonly provider: string;
  readonly model: string;
  /** Host's versioned commitment to the actual model/weights, independent of its address. */
  readonly modelRef: string;
  readonly dimensions: number;
  readonly authentication: HttpEmbeddingAuthentication;
  readonly limits: TextEmbeddingLimits;
  readonly maxResponseBytes: number;
  /** Explicit opt-in; requires endpoint support and contributes to representation recipe identity. */
  readonly sendDimensions: boolean;
}

export interface CreateHttpTextEmbedderOptions {
  readonly config: HttpTextEmbeddingConfig;
  readonly credentialResolver?: ProviderCredentialResolver;
  /** Borrowed fetch implementation; never closed by this adapter. Must honor request.signal. */
  readonly fetch?: typeof globalThis.fetch;
  readonly invocationPolicy?: TextEmbeddingInvocationPolicy;
}
