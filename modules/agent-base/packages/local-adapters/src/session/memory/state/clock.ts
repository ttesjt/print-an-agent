import { AgentSessionError } from '@print-an-agent/base-session';
import type { StoredMemorySession } from '../types/state.js';

export function readMemoryClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentSessionError(
      'SESSION_CONFIGURATION_INVALID',
      'Session clock must return a non-negative safe integer.'
    );
  }
  return timestamp;
}

export function touchMemorySession(session: StoredMemorySession, timestamp: number): void {
  session.updatedAt = Math.max(session.updatedAt, timestamp);
}
