import type { AgentWebPorts } from '../../application/ports.js';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { createWebAgentManagement } from './agents.js';
import { createWebConversationManagement } from './conversations.js';
import { createWebBackendServices, type WebBackendOptions } from './profile.js';
import { createWebSessionManagement } from './sessions.js';
import { createWebTemporaryConversationPort } from './temporary-conversation/service.js';

/** Host-owned backend. Drain business requests before closing; injected transports only borrow ports. */
export function createAgentBaseWebPorts(
  options: WebBackendOptions
): AgentWebPorts<AgentWebConfig> & { close(): Promise<void> } {
  const services = createWebBackendServices(options);
  return Object.freeze({
    close: services.close,
    temporaryConversations: createWebTemporaryConversationPort({
      agents: services.agents,
      modelHost: services.modelHost,
    }),
    agents: createWebAgentManagement(services),
    sessions: createWebSessionManagement(services),
    conversations: createWebConversationManagement(services),
  });
}
