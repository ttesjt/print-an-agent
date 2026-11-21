import type {
  SessionManagedAgentCompositionDefinition,
  SessionManagementPorts,
  SessionNavigationCapability,
  SessionNavigationPorts,
} from '@print-an-agent/base-composition';
import type { StandaloneAgentConfig } from '../../configuration/index.js';
import type { StandaloneRawAgent, StandaloneRuntimePorts } from '../../runtime/index.js';

export type StandaloneSessionDefinition<N> = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  N,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<N, SessionNavigationPorts>;
