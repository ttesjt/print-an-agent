import type {
  AgentCatalogPort,
  AgentConfigurationPort,
  AgentCreationPort,
  AgentInspectionPort,
  AgentLifecyclePort,
  ConversationHistoryPort,
  ConversationInteractionPort,
  SessionBranchMutationPort,
  SessionCatalogPort,
  SessionInspectionPort,
  SessionLifecyclePort,
  SessionMetadataPort,
  SessionNavigationPort,
  SessionPurgePort,
} from '@ta-agent/ui-contracts';

/** Application-owned grouping of the narrow Agent management capabilities used by Agent Web. */
export interface AgentManagementPort<Config>
  extends
    AgentCatalogPort,
    AgentConfigurationPort<Config>,
    AgentCreationPort<Config>,
    AgentInspectionPort<Config>,
    AgentLifecyclePort {}

/** Application-owned grouping of Session capabilities. It does not prescribe one backend. */
export interface SessionManagementPort
  extends
    SessionCatalogPort,
    SessionInspectionPort,
    SessionLifecyclePort,
    SessionMetadataPort,
    SessionNavigationPort,
    SessionPurgePort {}

/** Application-owned grouping of conversation capabilities used by the current composition. */
export interface ConversationManagementPort
  extends ConversationHistoryPort, ConversationInteractionPort, SessionBranchMutationPort {}

export interface AgentWebPorts<Config> {
  readonly agents: AgentManagementPort<Config>;
  readonly conversations: ConversationManagementPort;
  readonly sessions: SessionManagementPort;
}

export interface ConversationCommitTarget {
  readonly agentId: string;
  readonly branchId: string;
  readonly createdSession: boolean;
  readonly sessionId: string;
}
