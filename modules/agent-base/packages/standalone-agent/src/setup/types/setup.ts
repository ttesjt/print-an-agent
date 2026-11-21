import type { ManagedAgentCompositionDefinition } from '@print-an-agent/base-composition';
import type { StandaloneAgentConfig } from '../../configuration/index.js';
import type { StandaloneRawAgent, StandaloneRuntimePorts } from '../../runtime/index.js';

/** Composition lifetime only; business admission/cancellation/join remain the caller's responsibility. */
export interface StandaloneSetup<TNamespace> {
  readonly definition: ManagedAgentCompositionDefinition<
    StandaloneAgentConfig,
    TNamespace,
    StandaloneRuntimePorts,
    StandaloneRawAgent
  >;
  close(options?: StandaloneSetupCloseOptions): Promise<void>;
}

export interface StandaloneSetupCloseOptions {
  readonly mode?: 'drain' | 'abort';
}
