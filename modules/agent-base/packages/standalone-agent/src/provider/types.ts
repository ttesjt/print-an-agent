import type {
  ProviderReadiness,
  ProviderRuntimeInspection,
} from '@print-an-agent/base-composition';
import type { TextTokenCounterReferenceResolver } from '@print-an-agent/model-invocation-token-counters';

export interface StandaloneCredentialRuntimeOptions {
  readonly readEnvironmentVariable: (name: string) => string | undefined;
}

export interface StandaloneTokenCounterRuntimeOptions {
  /** Synchronous lookup of host-preloaded capabilities; no executable code is read from Config. */
  readonly resolveTextTokenCounter?: TextTokenCounterReferenceResolver;
}

export interface StandaloneProviderService {
  inspect(): ProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}
