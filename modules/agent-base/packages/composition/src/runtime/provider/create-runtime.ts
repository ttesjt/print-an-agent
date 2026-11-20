import { createPiProviderRuntime } from '@print-an-agent/model-invocation-pi';
import type { ProviderRuntime } from './types/capability.js';
import type { ProviderRuntimeOptions } from './types/runtime.js';

export function createProviderRuntime(options: ProviderRuntimeOptions): ProviderRuntime {
  const runtime = createPiProviderRuntime({
    ...(options.textTokenCounter === undefined
      ? {}
      : { textTokenCounter: options.textTokenCounter }),
    provider: options.config,
    ...(options.credentialResolver === undefined
      ? {}
      : { credentialResolver: options.credentialResolver }),
    ...(options.actorEngineId === undefined ? {} : { actorEngineId: options.actorEngineId }),
    ...(options.transportLivenessPolicy === undefined
      ? {}
      : { transportLivenessPolicy: options.transportLivenessPolicy }),
  });
  return Object.freeze({
    actorEngine: runtime.actorEngine,
    inspect: () => runtime.inspect(),
    checkReadiness: (readinessOptions?: Readonly<{ signal?: AbortSignal }>) =>
      runtime.checkReadiness(readinessOptions),
  });
}
