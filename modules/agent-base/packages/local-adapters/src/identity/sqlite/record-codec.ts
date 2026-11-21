import {
  AgentIdentityError,
  defineAgentIdentitySnapshot,
  type AgentIdentitySnapshot,
} from '@print-an-agent/base-identity-config/identity';
import type { SqliteRow } from './types/record.js';

function requireRowString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      `SQLite Identity column "${column}" must be a string.`
    );
  }
  return value;
}

export function decodeSnapshot(row: SqliteRow): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: {
      id: requireRowString(row, 'agent_id'),
      displayName: requireRowString(row, 'display_name'),
    },
    status: requireRowString(row, 'status'),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
