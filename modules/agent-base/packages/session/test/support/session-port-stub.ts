import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import type {
  ActiveSessionTurn,
  AppliedSessionNavigation,
  CompletedSessionTurn,
  NavigableCompactableSessionPort,
  ResolvedSessionReference,
  SessionCompaction,
  SessionContextSnapshot,
  SessionSnapshot,
  SessionTurn,
} from '../../src/index.js';

function unexpectedCall<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`Unexpected Session port call: ${method}.`));
}

export function createSessionPortStub(
  overrides: Partial<NavigableCompactableSessionPort> = {}
): NavigableCompactableSessionPort {
  return Object.freeze({
    resolve: () => unexpectedCall<ResolvedSessionReference>('resolve'),
    beginTurn: () => unexpectedCall<ActiveSessionTurn>('beginTurn'),
    loadHistory: () => unexpectedCall<readonly ModelMessage[]>('loadHistory'),
    loadContext: () => unexpectedCall<SessionContextSnapshot>('loadContext'),
    completeTurn: () => unexpectedCall<CompletedSessionTurn>('completeTurn'),
    failTurn: () => unexpectedCall<SessionTurn>('failTurn'),
    inspect: () => unexpectedCall<SessionSnapshot | undefined>('inspect'),
    readCompaction: () => unexpectedCall<SessionCompaction | undefined>('readCompaction'),
    commitCompaction: () => unexpectedCall<SessionCompaction>('commitCompaction'),
    applyNavigation: () => unexpectedCall<AppliedSessionNavigation>('applyNavigation'),
    ...overrides,
  });
}
