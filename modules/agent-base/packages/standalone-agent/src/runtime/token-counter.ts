import { resolveTextTokenCounterConfig } from '@ta-agent/model-invocation-token-counters';
import { AgentBaseStandaloneError } from '../errors.js';
import type { StandaloneProviderConfig, StandaloneTokenCounterRuntimeOptions } from '../types.js';

export function resolveStandaloneTextTokenCounter(
  config: StandaloneProviderConfig,
  options: StandaloneTokenCounterRuntimeOptions
) {
  if (config.textTokenCounter === undefined) return undefined;
  try {
    return resolveTextTokenCounterConfig(config.textTokenCounter, options.resolveTextTokenCounter);
  } catch (cause: unknown) {
    throw new AgentBaseStandaloneError('Standalone text counter binding is unavailable.', {
      cause,
    });
  }
}
