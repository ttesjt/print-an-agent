import {
  ModelOperationKind,
  ModelRunStatus,
  modelOutputsEqual,
  modelRunsEqual,
  modelStatesEqual,
  type ActiveModelRun,
  type ModelOutput,
  type ModelRun,
} from '@ta-agent/workbench-domain';

import { PersistenceRecordConflictError, RunTransitionPersistenceError } from '../errors.js';
import type {
  ExportCommit,
  ExportCommitter,
  SucceededExportCommit,
} from '../ports/export-committer.js';
import type { RecordBackedPersistenceOptions } from './create-record-backed-persistence.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';
import { assertProfileScope } from './profile-scope.js';
import { activeRunCanComplete } from './run-transition.js';

export function createRecordStoreExportCommitter(
  store: PersistenceRecordStore,
  options: RecordBackedPersistenceOptions
): ExportCommitter {
  return Object.freeze({
    commit: (input: ExportCommit): Promise<void> =>
      Promise.resolve().then(() => {
        assertProfileScope(options.profileId, input.run, 'run', input.run.runId);
        if (isSucceededCommit(input)) {
          assertProfileScope(options.profileId, input.output, 'output', input.output.outputId);
        }
        store.transaction(() => commitExport(store, input));
      }),
  });
}

function commitExport(store: PersistenceRecordStore, input: ExportCommit): void {
  assertCommitShape(input);
  const existingRun = store.runs.find(input.run.runId);
  if (existingRun === undefined) {
    throw new RunTransitionPersistenceError(input.run.runId, 'must exist before it can complete.');
  }
  if (!isActive(existingRun)) {
    if (commitAlreadyMatches(store, existingRun, input)) return;
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'has already reached a terminal state.'
    );
  }
  if (!activeRunCanComplete(existingRun, input.run)) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'cannot change its frozen operation selection while completing.'
    );
  }

  if (isSucceededCommit(input)) {
    assertSucceededCommit(input);
    storeOutput(store, input.output);
  }
  store.runs.store(input.run.runId, input.run);
}

function assertCommitShape(input: ExportCommit): void {
  const hasOutput = 'output' in input;
  if (
    (input.run.status === ModelRunStatus.Succeeded && !hasOutput) ||
    (input.run.status !== ModelRunStatus.Succeeded && hasOutput)
  ) {
    invalidSucceededCommit(input.run.runId);
  }
}

function assertSucceededCommit(input: SucceededExportCommit): void {
  const lineage = input.output.lineage;
  if (
    input.output.outputId !== input.run.result.outputId ||
    input.output.profileId !== input.run.profileId ||
    lineage.kind !== ModelOperationKind.Export ||
    lineage.runId !== input.run.runId ||
    lineage.exporterId !== input.run.exporterId ||
    lineage.capabilityId !== input.run.capabilityId ||
    lineage.runtimeBindingId !== input.run.runtimeBindingId ||
    lineage.slotEvidenceDigest !== input.run.slotEvidenceDigest ||
    !modelStatesEqual(lineage.source, input.run.source)
  ) {
    invalidSucceededCommit(input.run.runId);
  }
}

function invalidSucceededCommit(runId: string): never {
  throw new RunTransitionPersistenceError(
    runId,
    'must commit the exact Output declared by the succeeded Export Run.'
  );
}

function storeOutput(store: PersistenceRecordStore, output: ModelOutput): void {
  const existing = store.outputs.find(output.outputId);
  if (existing !== undefined && !modelOutputsEqual(existing, output)) {
    throw new PersistenceRecordConflictError('output', output.outputId);
  }
  store.outputs.store(output.outputId, output);
}

function commitAlreadyMatches(
  store: PersistenceRecordStore,
  storedRun: ModelRun,
  input: ExportCommit
): boolean {
  if (!modelRunsEqual(storedRun, input.run)) return false;
  if (!isSucceededCommit(input)) return true;
  const output = store.outputs.find(input.output.outputId);
  return output !== undefined && modelOutputsEqual(output, input.output);
}

function isActive(run: ModelRun): run is ActiveModelRun {
  return run.status === ModelRunStatus.Starting || run.status === ModelRunStatus.Running;
}

function isSucceededCommit(input: ExportCommit): input is SucceededExportCommit {
  return input.run.status === ModelRunStatus.Succeeded && 'output' in input;
}
