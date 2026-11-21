import {
  AgentSessionError,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
} from '@print-an-agent/base-session';
import { memoryJournalCoordination, MemoryRequestJournalAdapter } from '../../request/index.js';
import type { LocalLifecycleSessionPort } from '../../session/index.js';
import {
  MemorySessionAdapter,
  memorySessionCoordination,
  type MemorySessionAdapterOptions,
} from '../../session/index.js';
import type { CoordinatedSessionPersistence } from '../types/ports.js';
import { MemoryPersistenceQueue } from './execution-queue.js';

export function createMemorySessionPersistence(
  options: MemorySessionAdapterOptions = {}
): CoordinatedSessionPersistence {
  const backing = new MemorySessionAdapter(options);
  const journal = new MemoryRequestJournalAdapter(options.clock);
  const sessionState = backing[memorySessionCoordination]();
  const journalState = journal[memoryJournalCoordination]();
  journalState.bindExecution(sessionState.assertWrite);
  const queue = new MemoryPersistenceQueue();
  const session = Object.freeze<LocalLifecycleSessionPort>({
    resolve: (input) => queue.run(() => backing.resolve(input)),
    beginTurn: (input) => queue.run(() => backing.beginTurn(input)),
    completeTurn: (input) => queue.run(() => backing.completeTurn(input)),
    completeTurnWithPresentation: (input) =>
      queue.run(() => backing.completeTurnWithPresentation(input)),
    failTurn: (input) => queue.run(() => backing.failTurn(input)),
    loadHistory: (input) => queue.run(() => backing.loadHistory(input)),
    loadContext: (input) => queue.run(() => backing.loadContext(input)),
    inspect: (input) => queue.run(() => backing.inspect(input)),
    inspectSession: (input) => queue.run(() => backing.inspectSession(input)),
    readTurnPresentation: (input) => queue.run(() => backing.readTurnPresentation(input)),
    listSessions: (input) => queue.run(() => backing.listSessions(input)),
    listRetiredSessions: (input) => queue.run(() => backing.listRetiredSessions(input)),
    listSessionTurns: (input) => queue.run(() => backing.listSessionTurns(input)),
    renameSession: (input) => queue.run(() => backing.renameSession(input)),
    applyNavigation: (input) => queue.run(() => backing.applyNavigation(input)),
    readMemoryRecord: (input) => queue.run(() => backing.readMemoryRecord(input)),
    writeMemoryRecord: (input) => queue.run(() => backing.writeMemoryRecord(input)),
    listPendingMemoryRecords: (input) => queue.run(() => backing.listPendingMemoryRecords(input)),
    publishMemoryNavigation: (input) => queue.run(() => backing.publishMemoryNavigation(input)),
    readCompaction: (input) => queue.run(() => backing.readCompaction(input)),
    commitCompaction: (input) => queue.run(() => backing.commitCompaction(input)),
    retireSession: (input) => queue.run(() => backing.retireSession(input)),
    restoreSession: (input) => queue.run(() => backing.restoreSession(input)),
    acquireSessionExecution: (input) => queue.run(() => backing.acquireSessionExecution(input)),
    releaseSessionExecution: (input) => queue.run(() => backing.releaseSessionExecution(input)),
  });
  const maintenance = Object.freeze<CoordinatedSessionPersistence['maintenance']>({
    purgeSessionPersistence: (input) =>
      queue.run(async () => {
        const request = normalizePurgeSessionInput(input);
        const reference = { agentId: request.agentId, sessionId: request.sessionId };
        const restoreSession = sessionState.checkpoint(reference);
        const restoreJournal = journalState.checkpoint(reference);
        try {
          await backing.purgeSession(request);
          await journal.purgeSessionRequests(reference);
        } catch (cause: unknown) {
          restoreSession();
          restoreJournal();
          throw cause;
        }
      }),
    recoverSessionPersistence: (input) =>
      queue.run(async () => {
        const request = normalizeRecoverSessionExecutionsInput(input);
        const reference = { agentId: request.agentId, sessionId: request.sessionId };
        // Session recovery validates CAS before mutation; no other public operation can interleave.
        const fence = await backing.recoverSessionExecutions(request);
        try {
          await journal.recoverSessionRequests(reference);
          return fence;
        } catch (cause: unknown) {
          sessionState.fenceRecovery(reference);
          throw new AgentSessionError(
            'SESSION_RECOVERY_FAILED',
            'Coordinated recovery remains fenced.',
            { cause }
          );
        }
      }),
  });
  return Object.freeze({
    session,
    maintenance,
    requestJournal: Object.freeze<CoordinatedSessionPersistence['requestJournal']>({
      claim: (input) => queue.run(() => journal.claim(input)),
      complete: (input) => queue.run(() => journal.complete(input)),
      fail: (input) => queue.run(() => journal.fail(input)),
      inspect: (input) => queue.run(() => journal.inspect(input)),
    }),
  });
}
