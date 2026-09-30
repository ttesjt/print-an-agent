import {
  createProviderRuntime,
  type ProviderReadiness,
  type ProviderRuntimeInspection,
} from '@ta-agent/base-composition';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import type { StandaloneAgentConfig, StandaloneCredentialRuntimeOptions } from '../types.js';

export interface StandaloneProviderService {
  inspect(): ProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}

/** Creates out-of-band provider inspection/readiness from authoritative Standalone Config. */
export function createStandaloneProviderService(
  config: StandaloneAgentConfig,
  options: StandaloneCredentialRuntimeOptions
): StandaloneProviderService {
  const credentialResolver =
    config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(config.credential, options);
  const runtime = createProviderRuntime({
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
