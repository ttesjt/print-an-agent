import {
  createProviderRuntime,
  type ProviderReadiness,
  type ProviderRuntimeInspection,
} from '@ta-agent/base-composition';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import type {
  StandaloneAgentConfig,
  StandaloneCredentialRuntimeOptions,
  StandaloneTokenCounterRuntimeOptions,
} from '../types.js';
import { resolveStandaloneTextTokenCounter } from '../runtime/token-counter.js';

export interface StandaloneProviderService {
  inspect(): ProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}

/** Creates out-of-band provider inspection/readiness from authoritative Standalone Config. */
export function createStandaloneProviderService(
  config: StandaloneAgentConfig,
  options: StandaloneCredentialRuntimeOptions & StandaloneTokenCounterRuntimeOptions
): StandaloneProviderService {
  const credentialResolver =
    config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(config.credential, options);
  const textTokenCounter = resolveStandaloneTextTokenCounter(config.provider, options);
  const runtime = createProviderRuntime({
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    config: config.provider.config,
    transportLivenessPolicy: config.provider.transportLivenessPolicy,
    ...(credentialResolver === undefined ? {} : { credentialResolver }),
  });
  return Object.freeze({
    inspect: () => runtime.inspect(),
    checkReadiness: (readinessOptions?: Readonly<{ signal?: AbortSignal }>) =>
      runtime.checkReadiness(readinessOptions),
  });
}
