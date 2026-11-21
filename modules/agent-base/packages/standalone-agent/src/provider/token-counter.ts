import { resolveTextTokenCounterConfig } from '@print-an-agent/model-invocation-token-counters';
import type { StandaloneProviderConfig } from '../configuration/index.js';
import { AgentBaseStandaloneError } from '../errors.js';
import type { StandaloneTokenCounterRuntimeOptions } from './types.js';

export function resolveStandaloneTextTokenCounter(
  config: StandaloneProviderConfig,
  options: StandaloneTokenCounterRuntimeOptions
): ReturnType<typeof resolveTextTokenCounterConfig> | undefined {
  if (config.textTokenCounter === undefined) return undefined;
  try {
    return resolveTextTokenCounterConfig(config.textTokenCounter, options.resolveTextTokenCounter);
  } catch (cause: unknown) {
    throw new AgentBaseStandaloneError('Standalone text counter binding is unavailable.', {
      cause,
    });
  }
}
