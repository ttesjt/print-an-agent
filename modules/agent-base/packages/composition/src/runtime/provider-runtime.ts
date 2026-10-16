import { createPiProviderRuntime } from '@ta-agent/model-invocation-pi';
import type { ActorEngine } from '@ta-agent/model-invocation-core';
import type {
  ProviderReadiness,
  ProviderRuntimeInspection,
  ProviderRuntimeOptions,
} from './provider-contracts.js';

/** Provider runtime capabilities that are independent from an assembled Agent facade. */
export interface ProviderRuntime {
  readonly actorEngine: ActorEngine;
  inspect(): ProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}

export function createProviderRuntime(options: ProviderRuntimeOptions): ProviderRuntime {
  const runtime = createPiProviderRuntime({
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
