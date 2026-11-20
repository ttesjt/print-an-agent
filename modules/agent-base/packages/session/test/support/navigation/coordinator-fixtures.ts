import { parseAgentId } from '@print-an-agent/base-identity';
import {
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionExecutionId,
  parseSessionId,
  type AppliedSessionNavigation,
  type SessionExecutionLease,
  type SessionSnapshot,
} from '../../../src/index.js';

export const agentId = parseAgentId('navigation-coordinator-agent');
export const sessionId = parseSessionId('navigation-coordinator-session');

export function createSnapshot(revision = 0): SessionSnapshot {
  return Object.freeze({
    agentId,
    sessionId,
    navigation: Object.freeze({
      agentId,
      sessionId,
      revision,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: Object.freeze([
        Object.freeze({ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }),
      ]),
    }),
    turns: Object.freeze([]),
  });
}

export function createAppliedNavigation(revision = 1): AppliedSessionNavigation {
  return Object.freeze({
    operation: 'select',
    affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
    navigation: createSnapshot(revision).navigation,
  });
}

export function createExecutionLease(): SessionExecutionLease {
  return Object.freeze({
    agentId,
    sessionId,
    executionId: parseSessionExecutionId('navigation-execution'),
  });
}
