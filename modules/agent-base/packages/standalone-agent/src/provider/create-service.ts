import type { StandaloneAgentConfig } from '../configuration/index.js';
import { createStandaloneProviderRuntime } from './create-runtime.js';
import type {
  StandaloneCredentialRuntimeOptions,
  StandaloneProviderService,
  StandaloneTokenCounterRuntimeOptions,
} from './types.js';

/** Creates out-of-band provider inspection/readiness from authoritative Standalone Config. */
export function createStandaloneProviderService(
  config: StandaloneAgentConfig,
  options: StandaloneCredentialRuntimeOptions & StandaloneTokenCounterRuntimeOptions
): StandaloneProviderService {
  const runtime = createStandaloneProviderRuntime(config, options);
  return Object.freeze({
    inspect: () => runtime.inspect(),
    checkReadiness: (readinessOptions?: Readonly<{ signal?: AbortSignal }>) =>
      runtime.checkReadiness(readinessOptions),
  });
}
