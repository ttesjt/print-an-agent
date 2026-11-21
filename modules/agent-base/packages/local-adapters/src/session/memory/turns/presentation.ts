import {
  defineSessionTurnPresentation,
  type SessionTurnPresentationRecord,
  type SessionTurnPresentationReference,
} from '@print-an-agent/base-session';
import { memorySessionKey, requireMemoryTurn } from '../state/lookup.js';
import type { MemorySessionState } from '../types/state.js';

export function readMemoryTurnPresentation(
  state: MemorySessionState,
  reference: SessionTurnPresentationReference
): Promise<SessionTurnPresentationRecord | undefined> {
  return Promise.resolve().then(() => {
    const session = state.sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
    const presentation = session?.presentations.get(reference.turnId);
    if (presentation === undefined || session === undefined) return undefined;
    const turn = requireMemoryTurn(session, reference.turnId);
    return Object.freeze({
      agentId: session.agentId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      branchId: turn.branchId,
      presentation: defineSessionTurnPresentation(presentation),
    });
  });
}
