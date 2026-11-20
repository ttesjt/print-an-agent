import {
  executeSessionNavigation,
  type SessionNavigationOperationOptions,
  type SessionNavigationOutcome,
} from '@print-an-agent/base-session';
import { resolveManagedAgentNamespace } from '../../namespace/index.js';
import type { AgentManagementOperation } from '../../operation/index.js';
import { assertActive } from './cancellation.js';
import { validateNavigationPorts } from './provisioning.js';
import type { PreparedNavigationRequest, SessionNavigationDefinition } from './types/context.js';

export async function executeManagedNavigation<TNamespaceHandle>(
  operation: AgentManagementOperation,
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  request: PreparedNavigationRequest,
  options: SessionNavigationOperationOptions
): Promise<SessionNavigationOutcome> {
  assertActive(options.signal);
  const namespace = await resolveManagedAgentNamespace(
    operation,
    definition.namespace.port,
    request.agentId
  );
  assertActive(options.signal);
  const ports = validateNavigationPorts(
    operation,
    await definition.sessionNavigation.createPorts(namespace)
  );
  assertActive(options.signal);
  return executeSessionNavigation(
    {
      agentId: request.agentId,
      navigation: request.navigation,
      session: ports.session,
    },
    options
  );
}
