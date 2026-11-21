import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  type ResolveSessionRequest,
  type ResolvedSessionReference,
} from '@print-an-agent/base-session';
import { readMemoryClock } from './state/clock.js';
import { memorySessionKey, requireMemorySession } from './state/lookup.js';
import { resolveMemorySessionReference } from './state/snapshot.js';
import type { MemorySessionAuthority } from './types/lifecycle.js';
import type { MemorySessionState, StoredMemorySession } from './types/state.js';

export function resolveMemorySession(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  request: ResolveSessionRequest
): Promise<ResolvedSessionReference> {
  return Promise.resolve().then(() => {
    const agentId = parseAgentId(request.agentId);
    if (request.sessionId !== undefined) {
      authority.assertOpen({ agentId, sessionId: parseSessionId(request.sessionId) });
      return resolveMemorySessionReference(
        requireMemorySession(state.sessions, {
          agentId,
          sessionId: parseSessionId(request.sessionId),
        })
      );
    }
    const sessionId = parseSessionId(state.createSessionId());
    const key = memorySessionKey(agentId, sessionId);
    if (state.sessionIds.has(sessionId)) {
      throw new AgentSessionError(
        'SESSION_ID_CONFLICT',
        'Session ID generator returned an existing identity.'
      );
    }
    const timestamp = readMemoryClock(state.clock);
    const session: StoredMemorySession = {
      memoryRecords: new Map(),
      lifecycle: { status: 'active' },
      executionRevision: 0,
      executionState: 'ready',
      executions: new Map(),
      agentId,
      sessionId,
      createdAt: timestamp,
      branches: new Map([
        [
          DEFAULT_SESSION_BRANCH_ID,
          {
            branchId: DEFAULT_SESSION_BRANCH_ID,
            createdAt: timestamp,
          },
        ],
      ]),
      turns: [],
      presentations: new Map(),
      compactions: new Map(),
      metadataRevision: 0,
      metadataUpdatedAt: timestamp,
      updatedAt: timestamp,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      navigationRevision: 0,
    };
    state.sessions.set(key, session);
    state.sessionIds.add(sessionId);
    return resolveMemorySessionReference(session);
  });
}
