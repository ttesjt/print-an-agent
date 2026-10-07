export type ManagedAgentCompositionErrorCode = 'MANAGED_AGENT_COMPOSITION_INVALID';

export class ManagedAgentCompositionError extends Error {
  readonly code: ManagedAgentCompositionErrorCode;
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = 'ManagedAgentCompositionError';
    this.code = 'MANAGED_AGENT_COMPOSITION_INVALID';
    this.fieldPath = fieldPath;
  }
}

export type AgentManagementOperation =
  | 'create'
  | 'inspect'
  | 'list'
  | 'update-config'
  | 'import-config'
  | 'disable'
  | 'reactivate'
  | 'rename'
  | 'open'
  | 'list-sessions'
  | 'list-retired-sessions'
  | 'inspect-session'
  | 'list-session-turns'
  | 'retire-session'
  | 'restore-session'
  | 'purge-session'
  | 'recover-session'
  | 'inspect-session-navigation'
  | 'select-session-branch'
  | 'fork-session-branch'
  | 'rewind-session-branch';

export type AgentManagementErrorCode =
  | 'MANAGED_AGENT_REQUEST_INVALID'
  | 'MANAGED_AGENT_ALREADY_EXISTS'
  | 'MANAGED_AGENT_NOT_FOUND'
  | 'MANAGED_AGENT_DISABLED'
  | 'MANAGED_AGENT_NAMESPACE_INVALID'
  | 'MANAGED_AGENT_PROVISIONING_CONFLICT'
  | 'MANAGED_AGENT_PROVISIONING_CLEANUP_FAILED'
  | 'MANAGED_AGENT_AUTHORITY_INVALID'
  | 'MANAGED_AGENT_RUNTIME_INVALID'
  | 'MANAGED_AGENT_SESSION_INVALID'
  | 'MANAGED_AGENT_PROJECTION_FAILED'
  | 'MANAGED_AGENT_OPERATION_FAILED';

export type AgentManagementFailureDomain =
  | 'identity'
  | 'config'
  | 'session'
  | 'namespace'
  | 'management'
  | 'unexpected';

/** A safe summary used when provisioning and its cleanup both fail. */
export interface AgentManagementFailureSummary {
  readonly domain: AgentManagementFailureDomain;
  readonly code: string;
}

export class AgentManagementError extends Error {
  readonly code: AgentManagementErrorCode;
  readonly operation: AgentManagementOperation;
  readonly failures: readonly AgentManagementFailureSummary[];

  constructor(
    code: AgentManagementErrorCode,
    operation: AgentManagementOperation,
    message: string,
    failures: readonly AgentManagementFailureSummary[] = []
  ) {
    super(message);
    this.name = 'AgentManagementError';
    this.code = code;
    this.operation = operation;
    this.failures = Object.freeze([...failures]);
  }
}
