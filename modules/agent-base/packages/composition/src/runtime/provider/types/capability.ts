import type { ActorEngine } from '@print-an-agent/model-invocation-core';
import type { ProviderReadiness, ProviderRuntimeInspection } from './inspection.js';

/** Provider runtime capabilities that are independent from an assembled Agent facade. */
export interface ProviderRuntime {
  readonly actorEngine: ActorEngine;
  inspect(): ProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}
