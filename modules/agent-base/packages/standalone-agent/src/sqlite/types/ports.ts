import type {
  ManagedAgentAuthorityPortFactory,
  ManagedAgentRuntimePortFactory,
  SessionManagementPortFactory,
  SessionManagementPorts,
  SessionNavigationPortFactory,
  SessionNavigationPorts,
} from '@print-an-agent/base-composition';
import type { StandaloneAgentConfig } from '../../configuration/index.js';
import type { StandaloneRuntimePorts } from '../../runtime/index.js';
import type { SqliteDatabaseLocation } from './location.js';

export interface StandaloneSqlitePortFactories<N extends SqliteDatabaseLocation> {
  readonly createAuthorityPorts: ManagedAgentAuthorityPortFactory<N>;
  readonly createRuntimePorts: ManagedAgentRuntimePortFactory<
    StandaloneAgentConfig,
    N,
    StandaloneRuntimePorts
  >;
  readonly createSessionManagementPorts: SessionManagementPortFactory<N, SessionManagementPorts>;
  readonly createSessionNavigationPorts: SessionNavigationPortFactory<N, SessionNavigationPorts>;
}
