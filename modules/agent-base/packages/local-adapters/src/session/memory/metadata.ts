import {
  AgentSessionError,
  normalizeRenameSessionInput,
  type RenameSessionInput,
  type SessionInspection,
} from '@print-an-agent/base-session';
import { inspectMemorySession } from './query.js';
import { readMemoryClock } from './state/clock.js';
import { requireMemorySession } from './state/lookup.js';
import type { MemorySessionState } from './types/state.js';

export function renameMemorySession(
  state: MemorySessionState,
  input: RenameSessionInput
): Promise<SessionInspection> {
  return Promise.resolve().then(() => {
    const request = normalizeRenameSessionInput(input);
    const session = requireMemorySession(state.sessions, request);
    if (session.executionState === 'recovering')
      throw new AgentSessionError('SESSION_BUSY', 'Session recovery is unsettled.');
    if (session.metadataRevision !== request.expectedRevision) {
      throw new AgentSessionError(
        'SESSION_METADATA_CONFLICT',
        `Session metadata expected revision ${request.expectedRevision} but found ${session.metadataRevision}.`
      );
    }
    const updatedAt = Math.max(session.metadataUpdatedAt, readMemoryClock(state.clock));
    if (session.metadataRevision >= Number.MAX_SAFE_INTEGER) {
      throw new AgentSessionError(
        'SESSION_METADATA_INVALID',
        'Session metadata revision exhausted.'
      );
    }
    session.title = request.title;
    session.metadataRevision += 1;
    session.metadataUpdatedAt = updatedAt;
    const renamed = inspectMemorySession(state.sessions, request);
    if (renamed === undefined) throw new AgentSessionError('SESSION_NOT_FOUND', 'Session missing.');
    return renamed;
  });
}
