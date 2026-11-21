import { createProviderRuntime } from '@print-an-agent/base-composition';
import type { StandaloneAgentConfig } from '../configuration/index.js';
import { createStandaloneCredentialResolver } from './credential-resolver.js';
import { resolveStandaloneTextTokenCounter } from './token-counter.js';
import type {
  StandaloneCredentialRuntimeOptions,
  StandaloneTokenCounterRuntimeOptions,
} from './types.js';

/** Shared Provider assembly for Agent materialization and out-of-band readiness. */
export function createStandaloneProviderRuntime(
  config: StandaloneAgentConfig,
  options: StandaloneCredentialRuntimeOptions & StandaloneTokenCounterRuntimeOptions
): ReturnType<typeof createProviderRuntime> {
  const credentialResolver =
    config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(config.credential, options);
  const textTokenCounter = resolveStandaloneTextTokenCounter(config.provider, options);
  return createProviderRuntime({
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    config: config.provider.config,
    transportLivenessPolicy: config.provider.transportLivenessPolicy,
    ...(credentialResolver === undefined ? {} : { credentialResolver }),
  });
}
