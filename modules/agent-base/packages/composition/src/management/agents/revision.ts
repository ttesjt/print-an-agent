import { AgentManagementError, type AgentManagementOperation } from '../operation/index.js';

export function validateExpectedRevision(
  operation: AgentManagementOperation,
  value: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentManagementError(
      'MANAGED_AGENT_REQUEST_INVALID',
      operation,
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}
