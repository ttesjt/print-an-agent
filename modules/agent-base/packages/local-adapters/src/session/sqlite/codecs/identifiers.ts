import {
  AgentSessionError,
  parseSessionBranchId,
  parseTurnId,
  type SessionBranchSnapshot,
  type TurnId,
} from '@print-an-agent/base-session';

export function normalizePersistedTurnId(value: string, label: string): TurnId {
  try {
    return parseTurnId(value);
  } catch (cause: unknown) {
    throw new AgentSessionError('SESSION_RECORD_INVALID', `${label} is invalid.`, { cause });
  }
}

export function normalizePersistedBranchId(
  value: string,
  label: string
): SessionBranchSnapshot['branchId'] {
  try {
    return parseSessionBranchId(value);
  } catch (cause: unknown) {
    throw new AgentSessionError('SESSION_RECORD_INVALID', `${label} is invalid.`, { cause });
  }
}
