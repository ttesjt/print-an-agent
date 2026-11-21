import type {
  ProviderModelReference,
  TextEmbeddingLimits,
  TextEmbeddingRepresentation,
} from '@print-an-agent/model-invocation-core';

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

/** Adapter-validated execution settings; no Core representation data is carried here. */
export interface HttpEmbeddingTarget extends Pick<
  HttpTextEmbeddingConfig,
  'endpoint' | 'maxResponseBytes' | 'sendDimensions'
> {
  readonly reference: ProviderModelReference;
}

/** Only Core turns these untrusted fields into a validated representation. */
export interface HttpEmbeddingRepresentationInput extends Omit<
  TextEmbeddingRepresentation,
  'modelRef' | 'dimensions'
> {
  readonly modelRef: unknown;
  readonly dimensions: unknown;
}

/** Adapter preparation is complete; representation, limits and policy still enter Core validation. */
export interface PreparedHttpEmbeddingConfig {
  readonly target: HttpEmbeddingTarget;
  readonly representation: Pick<HttpEmbeddingRepresentationInput, 'modelRef' | 'dimensions'>;
  readonly limits: unknown;
}
