import type { SessionNavigationAgentCompositionDefinition } from '../definition/index.js';
import {
  type SessionNavigationPorts,
  type SessionNavigationService,
  forkManagedSessionBranch,
  inspectManagedSessionNavigation,
  rewindManagedSessionBranch,
  selectManagedSessionBranch,
} from '../sessions/index.js';
import { runManagementOperation } from './failures.js';

/** Creates a zero-I/O Service for Definitions with standard out-of-band Session navigation. */
export function createSessionNavigationService<
  TConfig,
  TNamespaceHandle,
  TRuntimePorts,
  TAgent,
  TSessionNavigationPorts extends SessionNavigationPorts,
>(
  definition: SessionNavigationAgentCompositionDefinition<
    TConfig,
    TNamespaceHandle,
    TRuntimePorts,
    TAgent,
    TSessionNavigationPorts
  >
): SessionNavigationService {
  return Object.freeze({
    inspect: (input, options) =>
      runManagementOperation('inspect-session-navigation', () =>
        inspectManagedSessionNavigation(definition, input, options)
      ),
    select: (input, options) =>
      runManagementOperation('select-session-branch', () =>
        selectManagedSessionBranch(definition, input, options)
      ),
    fork: (input, options) =>
      runManagementOperation('fork-session-branch', () =>
        forkManagedSessionBranch(definition, input, options)
      ),
    rewind: (input, options) =>
      runManagementOperation('rewind-session-branch', () =>
        rewindManagedSessionBranch(definition, input, options)
      ),
  } satisfies SessionNavigationService);
}
