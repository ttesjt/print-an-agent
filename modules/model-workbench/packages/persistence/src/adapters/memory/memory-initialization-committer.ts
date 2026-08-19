import {
  ModelOperationKind,
  ModelRunStatus,
  modelBasesEqual,
  modelRunDefinitionsEqual,
  modelRunsEqual,
  type BaseId,
  type ActiveModelRun,
  type ModelBase,
  type ModelRun,
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
  if (!isActive(existingRun)) {
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

function assertSameRunIdentity(running: ActiveModelRun, terminal: ModelRun): void {
  if (!modelRunDefinitionsEqual(running, terminal)) {
    throw new RunTransitionPersistenceError(
      terminal.runId,
      'cannot change its frozen operation selection while completing.'
    );
  }
}

function isActive(run: ModelRun): run is ActiveModelRun {
  return run.status === ModelRunStatus.Starting || run.status === ModelRunStatus.Running;
}

function assertSucceededCommit(input: SucceededInitializationCommit): void {
  const lineage = input.base.lineage;
  if (
    input.base.baseId !== input.run.result.baseId ||
    input.base.profileId !== input.run.profileId ||
    lineage.kind !== ModelOperationKind.Initialization ||
    lineage.runId !== input.run.runId ||
    lineage.initializerId !== input.run.initializerId ||
    lineage.capabilityId !== input.run.capabilityId ||
    lineage.runtimeBindingId !== input.run.runtimeBindingId ||
    lineage.slotEvidenceDigest !== input.run.slotEvidenceDigest
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
