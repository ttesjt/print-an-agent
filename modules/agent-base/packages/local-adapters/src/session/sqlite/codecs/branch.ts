import type { SessionBranchSnapshot } from '@print-an-agent/base-session';
import type { SqliteRow } from '../types/record.js';
import { optionalString, requireNonNegativeInteger, requireString } from './columns.js';
import { normalizePersistedBranchId, normalizePersistedTurnId } from './identifiers.js';

export function decodeBranch(row: SqliteRow): SessionBranchSnapshot {
  const parentValue = optionalString(row, 'parent_branch_id');
  const forkValue = optionalString(row, 'forked_from_turn_id');
  const headValue = optionalString(row, 'head_turn_id');
  return Object.freeze({
    branchId: normalizePersistedBranchId(
      requireString(row, 'branch_id'),
      'SQLite Session branch ID'
    ),
    ...(parentValue === undefined
      ? {}
      : {
          parentBranchId: normalizePersistedBranchId(
            parentValue,
            'SQLite Session parent branch ID'
          ),
        }),
    ...(forkValue === undefined
      ? {}
      : {
          forkedFromTurnId: normalizePersistedTurnId(forkValue, 'SQLite Session fork turn ID'),
        }),
    ...(headValue === undefined
      ? {}
      : {
          headTurnId: normalizePersistedTurnId(headValue, 'SQLite Session branch head turn ID'),
        }),
    createdAt: requireNonNegativeInteger(row, 'created_at'),
  });
}
