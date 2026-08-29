import { describe, expect, it } from 'vitest';

import {
  defineModelBase,
  defineModelState,
  defineExecutionReference,
  defineStartingInitializationRun,
  defineStartingTrainingRun,
  defineStartingExportRun,
  defineModelModification,
  defineModelOutput,
  failModelRun,
  ModelOperationKind,
  ModelRunResultKind,
  markModelRunDispatched,
  parseArtifactId,
  parseBaseId,
  parseCapabilityId,
  parseInitializerId,
  parseExporterId,
  parseModificationId,
  parseProfileId,
  parseOutputArtifactName,
  parseOutputId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  parseTrainerId,
  parseTimestamp,
  succeedInitializationRun,
  succeedExportRun,
  succeedTrainingRun,
  startModelRunExecution,
  updateModelRunProgress,
  type InitializationModelBase,
} from '@ta-agent/workbench-domain';

import {
  createMemoryPersistence,
  createMemoryProfilePersistenceAdapter,
  RunTransitionPersistenceError,
} from '../../src/index.js';

const slotEvidenceDigest = parseSha256Digest(`sha256:${'1'.repeat(64)}`);
const artifactDigest = parseSha256Digest(`sha256:${'2'.repeat(64)}`);

describe('createMemoryProfilePersistenceAdapter', () => {
  it('reuses one composition within a Profile and isolates different Profiles', async () => {
    const adapter = createMemoryProfilePersistenceAdapter();
    const first = await adapter.forProfile({ profileId: parseProfileId('profile:first') });
    const firstAgain = await adapter.forProfile({ profileId: parseProfileId('profile:first') });
    const second = await adapter.forProfile({ profileId: parseProfileId('profile:second') });

    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
  });
});

describe('createMemoryPersistence', () => {
  it('atomically completes an Initialization Run with its Base asset', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const baseId = parseBaseId('base:1');
    const base = defineModelBase({
      baseId,
      profileId: running.profileId,
      artifact: {
        artifactId: parseArtifactId('artifact:1'),
        digest: artifactDigest,
        handoff: {
          runtimeSupportId: parseRuntimeSupportId('artifacts.local'),
          receipt: { location: 'fixture://artifact:1' },
        },
      },
      lineage: {
        kind: ModelOperationKind.Initialization,
        runId: running.runId,
        initializerId: running.initializerId,
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
      },
    });
    const succeeded = succeedInitializationRun(running, baseId, TERMINAL_RECORDED_AT, {
      source: 'fixture',
    });

    await persistence.runs.create(running);
    await persistence.commits.initialization.commit({ run: succeeded, base });

    await expect(persistence.runs.find(running.runId)).resolves.toEqual(succeeded);
    await expect(persistence.parameters.findBase(baseId)).resolves.toEqual(base);
    expect(Object.isFrozen(await persistence.runs.find(running.runId))).toBe(true);
    expect(Object.isFrozen(await persistence.parameters.findBase(baseId))).toBe(true);
  });

  it('rejects a succeeded Run whose atomic commit names a different Base', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const differentBase = defineModelBase({
      baseId: parseBaseId('base:different'),
      profileId: running.profileId,
      artifact: {
        artifactId: parseArtifactId('artifact:1'),
        digest: artifactDigest,
        handoff: {
          runtimeSupportId: parseRuntimeSupportId('artifacts.local'),
          receipt: { location: 'fixture://artifact:1' },
        },
      },
      lineage: {
        kind: ModelOperationKind.Initialization,
        runId: running.runId,
        initializerId: running.initializerId,
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
      },
    });
    await persistence.runs.create(running);

    await expect(
      persistence.commits.initialization.commit({
        run: succeedInitializationRun(running, parseBaseId('base:declared'), TERMINAL_RECORDED_AT),
        base: differentBase,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(running.runId)).resolves.toEqual(running);
  });

  it('rejects a terminal commit that changes the durable operation input', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const altered = Object.freeze({
      ...running,
      input: Object.freeze({ source: 'fixture://different' }),
    });
    await persistence.runs.create(running);

    await expect(
      persistence.commits.initialization.commit({
        run: failModelRun(
          altered,
          Object.freeze({
            code: 'FIXTURE_FAILURE',
            message: 'fixture failure',
            retryable: false,
          }),
          TERMINAL_RECORDED_AT
        ),
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(running.runId)).resolves.toEqual(running);
  });

  it('rejects an Initialization result carrying Training lineage', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const baseId = parseBaseId('base:trained-lineage');
    const base = defineModelBase({
      baseId,
      profileId: running.profileId,
      artifact: artifactReference('artifact:trained-lineage'),
      lineage: {
        kind: ModelOperationKind.Training,
        runId: running.runId,
        trainerId: parseTrainerId('trainer:fixture'),
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
        source: defineModelState({ baseId: 'base:source' }),
      },
    });
    await persistence.runs.create(running);

    await expect(
      persistence.commits.initialization.commit({
        run: succeedInitializationRun(running, baseId, TERMINAL_RECORDED_AT),
        base: base as unknown as InitializationModelBase,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(running.runId)).resolves.toEqual(running);
  });

  it('rejects Initialization lineage that differs from the frozen Run selection', async () => {
    const persistence = createMemoryPersistence();
    const running = runningRun();
    const baseId = parseBaseId('base:mismatched-lineage');
    const base = defineModelBase({
      baseId,
      profileId: running.profileId,
      artifact: artifactReference('artifact:mismatched-lineage'),
      lineage: {
        kind: ModelOperationKind.Initialization,
        runId: running.runId,
        initializerId: parseInitializerId('initializer:different'),
        capabilityId: running.capabilityId,
        runtimeBindingId: running.runtimeBindingId,
        slotEvidenceDigest,
      },
    });
    await persistence.runs.create(running);

    await expect(
      persistence.commits.initialization.commit({
        run: succeedInitializationRun(running, baseId, TERMINAL_RECORDED_AT),
        base,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(running.runId)).resolves.toEqual(running);
  });

  it('persists an opaque execution receipt and forbids changing it after acceptance', async () => {
    const persistence = createMemoryPersistence();
    const starting = runningRun();
    const running = startModelRunExecution(
      starting,
      defineExecutionReference({
        runtimeSupportId: parseRuntimeSupportId('execution.local'),
        receipt: { jobId: 'job:1' },
      })
    );
    await persistence.runs.create(starting);
    await persistence.runs.updateActive(running);
    await persistence.runs.updateActive(updateModelRunProgress(running, { step: 2 }));

    await expect(persistence.runs.find(running.runId)).resolves.toMatchObject({
      status: 'running',
      execution: { receipt: { jobId: 'job:1' } },
      progress: { step: 2 },
    });
    await expect(
      persistence.runs.updateActive(
        startModelRunExecution(
          starting,
          defineExecutionReference({
            runtimeSupportId: parseRuntimeSupportId('execution.local'),
            receipt: { jobId: 'job:changed' },
          })
        )
      )
    ).rejects.toThrow();
  });

  it('atomically completes a Training Run with its Modification and exact source lineage', async () => {
    const persistence = createMemoryPersistence();
    const starting = trainingRun();
    const modificationId = parseModificationId('modification:1');
    const modification = defineModelModification({
      modificationId,
      profileId: starting.profileId,
      artifact: artifactReference('artifact:trained'),
      lineage: {
        kind: ModelOperationKind.Training,
        runId: starting.runId,
        trainerId: starting.trainerId,
        capabilityId: starting.capabilityId,
        runtimeBindingId: starting.runtimeBindingId,
        slotEvidenceDigest: starting.slotEvidenceDigest,
        source: starting.source,
      },
    });
    const succeeded = succeedTrainingRun(
      starting,
      {
        kind: ModelRunResultKind.Modification,
        modificationId,
      },
      TERMINAL_RECORDED_AT
    );

    await persistence.runs.create(starting);
    await persistence.commits.training.commit({ run: succeeded, modification });

    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(succeeded);
    await expect(persistence.parameters.findModification(modificationId)).resolves.toEqual(
      modification
    );
  });

  it('rejects Training lineage whose source differs from the frozen Run', async () => {
    const persistence = createMemoryPersistence();
    const starting = trainingRun();
    const modificationId = parseModificationId('modification:mismatched');
    const modification = defineModelModification({
      modificationId,
      profileId: starting.profileId,
      artifact: artifactReference('artifact:mismatched'),
      lineage: {
        kind: ModelOperationKind.Training,
        runId: starting.runId,
        trainerId: starting.trainerId,
        capabilityId: starting.capabilityId,
        runtimeBindingId: starting.runtimeBindingId,
        slotEvidenceDigest: starting.slotEvidenceDigest,
        source: defineModelState({ baseId: 'base:different' }),
      },
    });
    await persistence.runs.create(starting);

    await expect(
      persistence.commits.training.commit({
        run: succeedTrainingRun(
          starting,
          {
            kind: ModelRunResultKind.Modification,
            modificationId,
          },
          TERMINAL_RECORDED_AT
        ),
        modification,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(starting);
    await expect(persistence.parameters.findModification(modificationId)).resolves.toBeUndefined();
  });

  it('atomically completes an Export Run with its exact Output and lineage', async () => {
    const persistence = createMemoryPersistence();
    const starting = exportRun();
    const outputId = parseOutputId('output:1');
    const output = defineModelOutput({
      outputId,
      profileId: starting.profileId,
      artifacts: [
        {
          name: parseOutputArtifactName('model'),
          artifact: artifactReference('artifact:output'),
        },
      ],
      lineage: {
        kind: ModelOperationKind.Export,
        runId: starting.runId,
        exporterId: starting.exporterId,
        capabilityId: starting.capabilityId,
        runtimeBindingId: starting.runtimeBindingId,
        slotEvidenceDigest: starting.slotEvidenceDigest,
        source: starting.source,
      },
    });
    const succeeded = succeedExportRun(starting, outputId, TERMINAL_RECORDED_AT);

    await persistence.runs.create(starting);
    await persistence.commits.export.commit({ run: succeeded, output });

    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(succeeded);
    await expect(persistence.outputs.findOutput(outputId)).resolves.toEqual(output);
  });

  it('rejects Export lineage whose source differs from the frozen Run', async () => {
    const persistence = createMemoryPersistence();
    const starting = exportRun();
    const outputId = parseOutputId('output:mismatched');
    const output = defineModelOutput({
      outputId,
      profileId: starting.profileId,
      artifacts: [
        {
          name: parseOutputArtifactName('model'),
          artifact: artifactReference('artifact:output-mismatched'),
        },
      ],
      lineage: {
        kind: ModelOperationKind.Export,
        runId: starting.runId,
        exporterId: starting.exporterId,
        capabilityId: starting.capabilityId,
        runtimeBindingId: starting.runtimeBindingId,
        slotEvidenceDigest: starting.slotEvidenceDigest,
        source: defineModelState({ baseId: 'base:different' }),
      },
    });
    await persistence.runs.create(starting);

    await expect(
      persistence.commits.export.commit({
        run: succeedExportRun(starting, outputId, TERMINAL_RECORDED_AT),
        output,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(starting);
    await expect(persistence.outputs.findOutput(outputId)).resolves.toBeUndefined();
  });
});

function runningRun() {
  return markModelRunDispatched(
    defineStartingInitializationRun({
      runId: parseRunId('run:1'),
      profileId: parseProfileId('research-model'),
      initializerId: parseInitializerId('import'),
      capabilityId: parseCapabilityId('initializer.import'),
      runtimeBindingId: parseRuntimeBindingId('runtime.local'),
      slotEvidenceDigest,
      input: { source: 'fixture' },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
}

function artifactReference(artifactId: string) {
  return {
    artifactId: parseArtifactId(artifactId),
    digest: artifactDigest,
    handoff: {
      runtimeSupportId: parseRuntimeSupportId('artifacts.local'),
      receipt: { location: `fixture://${artifactId}` },
    },
  } as const;
}

function trainingRun() {
  return markModelRunDispatched(
    defineStartingTrainingRun({
      runId: parseRunId('run:training'),
      profileId: parseProfileId('research-model'),
      trainerId: parseTrainerId('trainer:fixture'),
      capabilityId: parseCapabilityId('trainer.fixture'),
      runtimeBindingId: parseRuntimeBindingId('runtime.local'),
      slotEvidenceDigest,
      source: defineModelState({ baseId: 'base:source' }),
      input: { epochs: 1 },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
}

function exportRun() {
  return markModelRunDispatched(
    defineStartingExportRun({
      runId: parseRunId('run:export'),
      profileId: parseProfileId('research-model'),
      exporterId: parseExporterId('exporter:fixture'),
      capabilityId: parseCapabilityId('exporter.fixture'),
      runtimeBindingId: parseRuntimeBindingId('runtime.local'),
      slotEvidenceDigest,
      source: defineModelState({
        baseId: 'base:source',
        modificationIds: ['modification:source'],
      }),
      input: { format: 'fixture' },
      createdAt: CREATED_AT,
    }),
    DISPATCHED_AT
  );
}

const CREATED_AT = parseTimestamp('2026-08-24T10:00:00.000Z');
const DISPATCHED_AT = parseTimestamp('2026-08-24T10:00:01.000Z');
const TERMINAL_RECORDED_AT = parseTimestamp('2026-08-24T10:05:00.000Z');
