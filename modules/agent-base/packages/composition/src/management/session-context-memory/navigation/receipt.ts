import {
  AgentSessionError,
  parseSessionBranchId,
  parseTurnId,
  type AppliedSessionNavigation,
  type SessionReference,
} from '@print-an-agent/base-session';
import { memoryObject } from '../journal.js';
import { revision } from './input.js';

export function applied(value: unknown, reference: SessionReference): AppliedSessionNavigation {
  const data = memoryObject(value);
  const nav = memoryObject(data.navigation);
  if (
    nav.agentId !== reference.agentId ||
    nav.sessionId !== reference.sessionId ||
    !Array.isArray(nav.branches) ||
    !['fork', 'rewind', 'select'].includes(String(data.operation))
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation receipt.');
  const operation = data.operation;
  if (operation !== 'fork' && operation !== 'rewind' && operation !== 'select')
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation operation.');
  return {
    operation,
    affectedBranchId: parseSessionBranchId(data.affectedBranchId),
    navigation: {
      agentId: reference.agentId,
      sessionId: reference.sessionId,
      revision: revision(nav.revision),
      selectedBranchId: parseSessionBranchId(nav.selectedBranchId),
      branches: nav.branches.map((raw: unknown) => {
        const b = memoryObject(raw);
        return {
          branchId: parseSessionBranchId(b.branchId),
          createdAt: revision(b.createdAt),
          ...(b.parentBranchId === undefined
            ? {}
            : { parentBranchId: parseSessionBranchId(b.parentBranchId) }),
          ...(b.forkedFromTurnId === undefined
            ? {}
            : { forkedFromTurnId: parseTurnId(b.forkedFromTurnId) }),
          ...(b.headTurnId === undefined ? {} : { headTurnId: parseTurnId(b.headTurnId) }),
        };
      }),
    },
  };
}
