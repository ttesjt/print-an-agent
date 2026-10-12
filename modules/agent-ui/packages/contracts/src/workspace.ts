import type { AgentDetails, AgentManagementResult, AgentSummary } from './agent-types.js';
import type { AgentLifecyclePort } from './agent-lifecycle.js';
import type { AgentMetadataPort } from './agent-metadata.js';
import type { ConversationHistoryPort } from './conversation-history.js';
import type { ConversationInteractionPort } from './conversation-interaction.js';
import type { SessionCatalogPort, SessionInspectionPort } from './session-catalog.js';
import type { SessionNavigationPort } from './session-navigation.js';
import type { SessionMetadataPort } from './session-metadata.js';
import type { SessionLifecyclePort, SessionPurgePort } from './session-lifecycle.js';
import type { SessionBranchMutationPort } from './session-branch-mutations.js';

export interface AgentCatalogPage {
  readonly records: readonly AgentSummary[];
  readonly nextCursor?: string;
}

/** Page cursors are opaque. A single-page backend simply omits nextCursor. */
export interface WorkspaceAgentPort
  extends Partial<AgentLifecyclePort>, Partial<AgentMetadataPort> {
  listAgentPage(input: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<AgentManagementResult<AgentCatalogPage>>;
  inspectAgentDetails(input: {
    readonly agentId: string;
    readonly signal?: AbortSignal;
  }): Promise<AgentManagementResult<AgentDetails>>;
}

export interface WorkspaceSessionPort
  extends
    SessionCatalogPort,
    SessionInspectionPort,
    Pick<SessionNavigationPort, 'inspectSessionNavigation'>,
    Partial<Pick<SessionNavigationPort, 'selectSessionBranch'>>,
    Partial<SessionMetadataPort>,
    Partial<SessionLifecyclePort>,
    Partial<SessionPurgePort> {}

export interface WorkspaceConversationPort
  extends
    ConversationHistoryPort,
    ConversationInteractionPort,
    Partial<SessionBranchMutationPort> {}

/** A structural composition of narrow capabilities, not a resource owner or service registry. */
export interface WorkspacePorts {
  readonly agents: WorkspaceAgentPort;
  readonly sessions: WorkspaceSessionPort;
  readonly conversations: WorkspaceConversationPort;
}
