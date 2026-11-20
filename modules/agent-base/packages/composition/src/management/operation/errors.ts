import type {
  AgentManagementErrorCode,
  AgentManagementFailureSummary,
  AgentManagementOperation,
} from './types/errors.js';

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
