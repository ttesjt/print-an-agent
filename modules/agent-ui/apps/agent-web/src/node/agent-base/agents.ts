import { parseAgentId } from '@ta-agent/base-identity';
import type { AgentManagementPort } from '../../application/ports.js';
import type { DemoAgentConfig } from '../../application/demo-agent-config.js';
import type { AgentManagementResult } from '@ta-agent/ui-contracts';
import { defineWebAgentConfig } from './config.js';
import { agentFailure } from './failures.js';
import { projectAgent, revision } from './projection.js';
import type { WebBackendServices } from './profile.js';

export function createWebAgentManagement(
  services: WebBackendServices
): AgentManagementPort<DemoAgentConfig> {
  const query = async <Value>(
    signal: AbortSignal | undefined,
    action: () => Promise<Value>,
    readRevision?: () => Promise<string>
  ): Promise<AgentManagementResult<Value>> => {
    signal?.throwIfAborted();
    try {
      const value = await action();
      signal?.throwIfAborted();
      return { status: 'succeeded', value };
    } catch (error) {
      signal?.throwIfAborted();
      return { status: 'failed', failure: await agentFailure(error, readRevision) };
    }
  };
  const inspect = async (id: string) =>
    projectAgent(await services.agents.inspect(parseAgentId(id)));
  return {
    listAgents: (input = {}) =>
      query(input.signal, async () =>
        (await services.agents.list()).map((snapshot) => {
          const details = projectAgent(snapshot).details;
          return {
            agentId: details.agentId,
            displayName: details.displayName,
            identityRevision: details.identityRevision,
            status: details.status,
            updatedAt: details.updatedAt,
          };
        })
      ),
    inspectAgent: (input) => query(input.signal, () => inspect(input.agentId)),
    readAgentConfig: (input) =>
      query(input.signal, async () => (await inspect(input.agentId)).config),
    createAgent: (input) =>
      query(input.signal, async () =>
        projectAgent(
          await services.agents.create({
            identity: { id: input.identity.agentId, displayName: input.identity.displayName },
            config: defineWebAgentConfig(input.config),
          })
        )
      ),
    updateAgentConfig: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.updateConfig({
              agentId: parseAgentId(input.agentId),
              config: defineWebAgentConfig(input.config),
              expectedRevision: revision(input.expectedRevision),
            })
          ).config,
        async () => (await inspect(input.agentId)).config.revision
      ),
    disableAgent: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.disable({
              agentId: parseAgentId(input.agentId),
              expectedIdentityRevision: revision(input.expectedRevision),
            })
          ).details,
        async () => (await inspect(input.agentId)).details.identityRevision
      ),
    reactivateAgent: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.reactivate({
              agentId: parseAgentId(input.agentId),
              expectedIdentityRevision: revision(input.expectedRevision),
            })
          ).details,
        async () => (await inspect(input.agentId)).details.identityRevision
      ),
  };
}
