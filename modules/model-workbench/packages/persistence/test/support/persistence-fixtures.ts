import {
  defineModelBase,
  defineModelModification,
  defineModelOutput,
  defineModelState,
  defineStartingExportRun,
  defineStartingInitializationRun,
  defineStartingTrainingRun,
  ModelOperationKind,
  ModelRunResultKind,
  markModelRunDispatched,
  parseArtifactId,
  parseBaseId,
  parseCapabilityId,
  parseExporterId,
  parseInitializerId,
  parseModificationId,
  parseOutputArtifactName,
  parseOutputId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  parseTrainerId,
  parseTimestamp,
  succeedExportRun,
  succeedInitializationRun,
  succeedTrainingRun,
  type ArtifactReference,
  type StartingExportRun,
  type StartingInitializationRun,
  type StartingTrainingRun,
} from '@ta-agent/workbench-domain';

import type {
  SucceededExportCommit,
  SucceededInitializationCommit,
  SucceededTrainingModificationCommit,
} from '../../src/index.js';

export const fixtureProfileId = parseProfileId('profile:fixture');
export const alternateProfileId = parseProfileId('profile:alternate');
export const fixtureSlotEvidence = parseSha256Digest(`sha256:${'1'.repeat(64)}`);
const fixtureArtifactDigest = parseSha256Digest(`sha256:${'2'.repeat(64)}`);

export interface InitializationPersistenceFixture {
  readonly starting: StartingInitializationRun;
  readonly commit: SucceededInitializationCommit;
}

export interface TrainingPersistenceFixture {
  readonly starting: StartingTrainingRun;
  readonly commit: SucceededTrainingModificationCommit;
}

export interface ExportPersistenceFixture {
  readonly starting: StartingExportRun;
  readonly commit: SucceededExportCommit;
}

export function initializationFixture(suffix: string): InitializationPersistenceFixture {
  const run = markModelRunDispatched(
    defineStartingInitializationRun({
      runId: parseRunId(`run:initialization:${suffix}`),
      profileId: fixtureProfileId,
      initializerId: parseInitializerId('initializer:fixture'),
      capabilityId: parseCapabilityId('capability:initializer'),
      runtimeBindingId: parseRuntimeBindingId('binding:initializer'),
      slotEvidenceDigest: fixtureSlotEvidence,
      input: { fixture: suffix },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
  const baseId = parseBaseId(`base:${suffix}`);
  return {
    starting: run,
    commit: {
      run: succeedInitializationRun(run, baseId, TERMINAL_RECORDED_AT, { fixture: suffix }),
      base: defineModelBase({
        baseId,
        profileId: fixtureProfileId,
        artifact: artifactReference(`artifact:base:${suffix}`),
        lineage: {
          kind: ModelOperationKind.Initialization,
          runId: run.runId,
          initializerId: run.initializerId,
          capabilityId: run.capabilityId,
          runtimeBindingId: run.runtimeBindingId,
          slotEvidenceDigest: run.slotEvidenceDigest,
        },
      }),
    },
  };
}

export function trainingModificationFixture(suffix: string): TrainingPersistenceFixture {
  const run = markModelRunDispatched(
    defineStartingTrainingRun({
      runId: parseRunId(`run:training:${suffix}`),
      profileId: fixtureProfileId,
      trainerId: parseTrainerId('trainer:fixture'),
      capabilityId: parseCapabilityId('capability:trainer'),
      runtimeBindingId: parseRuntimeBindingId('binding:trainer'),
      slotEvidenceDigest: fixtureSlotEvidence,
      source: defineModelState({
        baseId: `base:${suffix}`,
        modificationIds: [`modification:source:${suffix}`],
      }),
      input: { fixture: suffix },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
  const modificationId = parseModificationId(`modification:${suffix}`);
  return {
    starting: run,
    commit: {
      run: succeedTrainingRun(
        run,
        {
          kind: ModelRunResultKind.Modification,
          modificationId,
        },
        TERMINAL_RECORDED_AT
      ),
      modification: defineModelModification({
        modificationId,
        profileId: fixtureProfileId,
        artifact: artifactReference(`artifact:modification:${suffix}`),
        lineage: {
          kind: ModelOperationKind.Training,
          runId: run.runId,
          trainerId: run.trainerId,
          capabilityId: run.capabilityId,
          runtimeBindingId: run.runtimeBindingId,
          slotEvidenceDigest: run.slotEvidenceDigest,
          source: run.source,
        },
      }),
    },
  };
}

export function exportFixture(suffix: string): ExportPersistenceFixture {
  const run = markModelRunDispatched(
    defineStartingExportRun({
      runId: parseRunId(`run:export:${suffix}`),
      profileId: fixtureProfileId,
      exporterId: parseExporterId('exporter:fixture'),
      capabilityId: parseCapabilityId('capability:exporter'),
      runtimeBindingId: parseRuntimeBindingId('binding:exporter'),
      slotEvidenceDigest: fixtureSlotEvidence,
      source: defineModelState({
        baseId: `base:${suffix}`,
        modificationIds: [`modification:${suffix}`],
      }),
      input: { fixture: suffix },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
  const outputId = parseOutputId(`output:${suffix}`);
  return {
    starting: run,
    commit: {
      run: succeedExportRun(run, outputId, TERMINAL_RECORDED_AT, { fixture: suffix }),
      output: defineModelOutput({
        outputId,
        profileId: fixtureProfileId,
        artifacts: [
          {
            name: parseOutputArtifactName('model'),
            artifact: artifactReference(`artifact:output:${suffix}`),
          },
        ],
        lineage: {
          kind: ModelOperationKind.Export,
          runId: run.runId,
          exporterId: run.exporterId,
          capabilityId: run.capabilityId,
          runtimeBindingId: run.runtimeBindingId,
          slotEvidenceDigest: run.slotEvidenceDigest,
          source: run.source,
        },
      }),
    },
  };
}

const CREATED_AT = parseTimestamp('2026-08-24T10:00:00.000Z');
const DISPATCHED_AT = parseTimestamp('2026-08-24T10:00:01.000Z');
const TERMINAL_RECORDED_AT = parseTimestamp('2026-08-24T10:05:00.000Z');

export function artifactReference(artifactId: string): ArtifactReference {
  return {
    artifactId: parseArtifactId(artifactId),
    digest: fixtureArtifactDigest,
    handoff: {
      runtimeSupportId: parseRuntimeSupportId('artifacts.local'),
      receipt: { location: `fixture://${artifactId}` },
    },
  };
}
