import type { AgentCatalogPort, AgentSummary, ListAgentsOptions } from '@ta-agent/ui-contracts';

const AGENTS: readonly AgentSummary[] = Object.freeze([
  Object.freeze({
    agentId: 'research-assistant',
    displayName: 'Research Assistant',
    status: 'active',
  }),
  Object.freeze({
    agentId: 'review-assistant',
    displayName: 'Review Assistant',
    status: 'disabled',
  }),
]);

export function createDeterministicAgentCatalog(): AgentCatalogPort {
  return Object.freeze({
    listAgents: (options: ListAgentsOptions = {}) => {
      return Promise.resolve().then(() => {
        options.signal?.throwIfAborted();
        return AGENTS;
      });
    },
  });
}
