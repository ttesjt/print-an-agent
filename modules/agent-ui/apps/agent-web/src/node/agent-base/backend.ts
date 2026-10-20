import type { AgentWebPorts } from '../../application/ports.js';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { createWebAgentManagement } from './agents.js';
import { createWebConversationManagement } from './conversations.js';
import { createWebBackendServices, type WebBackendOptions } from './profile.js';
import { createWebSessionManagement } from './sessions.js';
import { createWebTemporaryConversationPort } from './temporary-conversation/service.js';

export function createAgentBaseWebPorts(options: WebBackendOptions): AgentWebPorts<AgentWebConfig> {
  const services = createWebBackendServices(options);
  return Object.freeze({
    temporaryConversations: createWebTemporaryConversationPort({
      agents: services.agents,
      modelHost: services.modelHost,
    }),
    agents: createWebAgentManagement(services),
    sessions: createWebSessionManagement(services),
    conversations: createWebConversationManagement(services),
  });
}
