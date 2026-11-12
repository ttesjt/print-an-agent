import type { WorkspacePorts } from '@print-an-agent/ui-contracts';
import type { AgentWebPorts } from './ports.js';
import type { AgentWebConfig } from './agent-config.js';
export function createDefaultWorkspacePorts(ports: AgentWebPorts<AgentWebConfig>): WorkspacePorts {
  const workspace: WorkspacePorts = {
    agents: {
      // Agent Base currently exposes a full catalog. This adapter honestly returns one page.
      listAgentPage: async ({ signal }) => {
        const result = await ports.agents.listAgents(signal === undefined ? {} : { signal });
        return result.status === 'failed'
          ? result
          : { status: 'succeeded', value: { records: result.value } };
      },
      inspectAgentDetails: async (input) => {
        const result = await ports.agents.inspectAgent(input);
        return result.status === 'failed'
          ? result
          : { status: 'succeeded', value: result.value.details };
      },
      renameAgent: (input) => ports.agents.renameAgent(input),
      disableAgent: (input) => ports.agents.disableAgent(input),
      reactivateAgent: (input) => ports.agents.reactivateAgent(input),
    },
    sessions: ports.sessions,
    conversations: ports.conversations,
  };

  return workspace;
}
