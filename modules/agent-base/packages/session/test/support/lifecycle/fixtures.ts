import { parseAgentId } from '@print-an-agent/base-identity';
import {
  AgentSessionError,
  defineSessionExecutionFence,
  defineSessionLifecycleSnapshot,
  normalizeSessionExecutionLease,
  parseSessionId,
  type SessionLifecycleMutationInput,
  type SessionLifecycleSnapshot,
} from '../../../src/index.js';

export function captureSessionError(run: () => unknown): AgentSessionError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof AgentSessionError) return error;
    throw error;
  }
  throw new Error('Expected a structured Session error.');
}

export const reference = Object.freeze({
  agentId: parseAgentId('agent'),
  sessionId: parseSessionId('conversation'),
});

export const active = defineSessionLifecycleSnapshot({
  ...reference,
  status: 'active',
  metadataRevision: 3,
  metadataUpdatedAt: 10,
});

export const retired = defineSessionLifecycleSnapshot({
  ...reference,
  status: 'retired',
  metadataRevision: 4,
  metadataUpdatedAt: 20,
  retiredAt: 20,
});

export const idle = defineSessionExecutionFence({
  revision: 6,
  state: 'ready',
  activeLeaseCount: 0,
  pendingWorkCount: 0,
});

export const lease = normalizeSessionExecutionLease({ ...reference, executionId: 'execution-a' });

export function mutation(snapshot: SessionLifecycleSnapshot): SessionLifecycleMutationInput {
  return {
    agentId: snapshot.agentId,
    sessionId: snapshot.sessionId,

    expectedRevision: snapshot.metadataRevision,
  };
}
