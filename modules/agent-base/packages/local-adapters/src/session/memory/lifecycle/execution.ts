import {
  normalizeSessionExecutionLease,
  parseSessionExecutionId,
  type SessionExecutionLease,
  type SessionReference,
} from '@print-an-agent/base-session';
import { randomUUID } from 'node:crypto';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import { advanceMemoryExecution } from './state.js';

export function acquireMemoryExecution(
  authority: MemorySessionAuthority,
  reference: SessionReference
): SessionExecutionLease {
  authority.assertOpen(reference);
  const session = authority.require(reference);
  const lease = Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    executionId: parseSessionExecutionId(randomUUID()),
  });
  advanceMemoryExecution(session);
  session.executions.set(lease.executionId, lease);
  return lease;
}

export function releaseMemoryExecution(
  authority: MemorySessionAuthority,
  input: SessionExecutionLease
): void {
  const lease = normalizeSessionExecutionLease(input);
  const session = authority.assertWrite({ ...lease, execution: lease });
  advanceMemoryExecution(session);
  session.executions.delete(lease.executionId);
}
