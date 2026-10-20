import type {
  AgentCatalogPort,
  AgentConfigurationPort,
  AgentCreationPort,
  AgentInspectionPort,
  AgentLifecyclePort,
  AgentMetadataPort,
  ConversationHistoryPort,
  ConversationInteractionPort,
  ConversationSessionAdmission,
  SessionBranchMutationPort,
  SessionCatalogPort,
  SessionInspectionPort,
  SessionLifecyclePort,
  SessionMetadataPort,
  SessionNavigationPort,
  SessionPurgePort,
  AgentManagementResult,
} from '@ta-agent/ui-contracts';
import type { AgentModelStatus } from './agent-config.js';
import type { TemporaryConversationPort } from '../temporary-conversation/contracts.js';

/** Application-owned grouping of the narrow Agent management capabilities used by Agent Web. */
export interface AgentManagementPort<Config>
  extends
    AgentCatalogPort,
    AgentConfigurationPort<Config>,
    AgentCreationPort<Config>,
    AgentInspectionPort<Config>,
    AgentLifecyclePort,
    AgentMetadataPort {
  inspectModel(
    input: Readonly<{ agentId: string; signal?: AbortSignal }>
  ): Promise<AgentManagementResult<AgentModelStatus>>;
  testModelConnection(
    input: Readonly<{ agentId: string; expectedRevision: string; signal?: AbortSignal }>
  ): Promise<AgentManagementResult<Readonly<{ revision: string; checkedAt: string }>>>;
}

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
  readonly temporaryConversations?: TemporaryConversationPort;
  readonly agents: AgentManagementPort<Config>;
  readonly conversations: ConversationManagementPort;
  readonly sessions: SessionManagementPort;
}

export interface ConversationCommitTarget {
  readonly agentId: string;
  readonly branchId: string;
  readonly createdSession: boolean;
  readonly sessionId: string;
  readonly draftId?: string;
}

export interface ConversationAdmissionTarget {
  readonly admission: ConversationSessionAdmission;
  readonly draftId?: string;
}
