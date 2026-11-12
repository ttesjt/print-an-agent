import type { ConversationSessionAdmission } from '@print-an-agent/ui-contracts';
export type {
  WorkspaceConversationPort as ConversationManagementPort,
  WorkspaceSessionPort as SessionManagementPort,
} from '@print-an-agent/ui-contracts';
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
