import {
  AgentSessionError,
  parseSessionFailureCode,
  type SessionTurn,
} from '@print-an-agent/base-session';
import type { SqliteRow } from '../types/record.js';
import { optionalString, requireString } from './columns.js';
import { normalizePersistedBranchId, normalizePersistedTurnId } from './identifiers.js';
import { decodeAssistantMessage, decodeUserMessage } from './message.js';

export function decodeTurn(row: SqliteRow): SessionTurn {
  const turnId = normalizePersistedTurnId(requireString(row, 'turn_id'), 'SQLite Session turn ID');
  const branchId = normalizePersistedBranchId(
    requireString(row, 'branch_id'),
    'SQLite Session turn branch ID'
  );
  const parentValue = optionalString(row, 'parent_turn_id');
  const parentTurnId =
    parentValue === undefined
      ? undefined
      : normalizePersistedTurnId(parentValue, 'SQLite Session parent turn ID');
  const lineage = {
    branchId,
    ...(parentTurnId === undefined ? {} : { parentTurnId }),
  } as const;
  const status = requireString(row, 'status');
  const userMessage = decodeUserMessage(requireString(row, 'user_message'));
  if (status === 'active') return Object.freeze({ status, turnId, ...lineage, userMessage });
  if (status === 'completed') {
    return Object.freeze({
      status,
      turnId,
      ...lineage,
      userMessage,
      assistantMessage: decodeAssistantMessage(requireString(row, 'assistant_message')),
    });
  }
  if (status === 'failed') {
    let failureCode: string;
    try {
      failureCode = parseSessionFailureCode(requireString(row, 'failure_code'));
    } catch (cause: unknown) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session record contains an invalid failure code.',
        { cause }
      );
    }
    return Object.freeze({ status, turnId, ...lineage, userMessage, failureCode });
  }
  throw new AgentSessionError(
    'SESSION_RECORD_INVALID',
    `SQLite Session record contains unsupported turn status "${status}".`
  );
}
