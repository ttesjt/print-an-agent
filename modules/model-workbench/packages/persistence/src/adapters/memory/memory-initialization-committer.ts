import {
  ModelRunStatus,
  modelBasesEqual,
  modelRunsEqual,
  type BaseId,
  type ModelBase,
  type ModelRun,
  type RunningModelRun,
} from '@ta-agent/workbench-domain';

import { PersistenceRecordConflictError, RunTransitionPersistenceError } from '../../errors.js';
import type {
  InitializationCommit,
  InitializationCommitter,
  SucceededInitializationCommit,
} from '../../ports/initialization-committer.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryInitializationCommitter(
  state: MemoryPersistenceState
): InitializationCommitter {
  return Object.freeze({
    commit: (input: InitializationCommit): Promise<void> =>
      Promise.resolve().then(() => commitInitialization(state, input)),
  });
}

function commitInitialization(state: MemoryPersistenceState, input: InitializationCommit): void {
  const existingRun = state.runs.get(input.run.runId);
  if (existingRun === undefined) {
    throw new RunTransitionPersistenceError(input.run.runId, 'must exist before it can complete.');
  }
  if (existingRun.status !== ModelRunStatus.Running) {
    if (commitAlreadyMatches(existingRun, input, state.bases)) return;
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'has already reached a terminal state.'
    );
  }
  assertSameRunIdentity(existingRun, input.run);
  if (isSucceededCommit(input)) {
    assertSucceededCommit(input);
    const existingBase = state.bases.get(input.base.baseId);
    if (existingBase !== undefined && !modelBasesEqual(existingBase, input.base)) {
      throw new PersistenceRecordConflictError('base', input.base.baseId);
    }
    state.bases.set(input.base.baseId, input.base);
  }
  state.runs.set(input.run.runId, input.run);
}

function assertSameRunIdentity(running: RunningModelRun, terminal: ModelRun): void {
  if (
    running.operation !== terminal.operation ||
    running.profileId !== terminal.profileId ||
    running.initializerId !== terminal.initializerId ||
    running.capabilityId !== terminal.capabilityId ||
    running.runtimeBindingId !== terminal.runtimeBindingId ||
    running.slotEvidenceDigest !== terminal.slotEvidenceDigest
  ) {
    throw new RunTransitionPersistenceError(
      terminal.runId,
      'cannot change its frozen operation selection while completing.'
    );
  }
}

function assertSucceededCommit(input: SucceededInitializationCommit): void {
  if (
    input.base.baseId !== input.run.result.baseId ||
    input.base.lineage.runId !== input.run.runId ||
    input.base.profileId !== input.run.profileId
  ) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'must commit the exact Base declared by the succeeded Run.'
    );
  }
}

function commitAlreadyMatches(
  storedRun: ModelRun,
  input: InitializationCommit,
  storedBases: ReadonlyMap<BaseId, ModelBase>
): boolean {
  if (!modelRunsEqual(storedRun, input.run)) return false;
  if (!isSucceededCommit(input)) return true;
  const storedBase = storedBases.get(input.base.baseId);
  return storedBase !== undefined && modelBasesEqual(storedBase, input.base);
}

function isSucceededCommit(input: InitializationCommit): input is SucceededInitializationCommit {
  return input.run.status === ModelRunStatus.Succeeded && 'base' in input;
}
