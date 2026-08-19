import { describe, expect, it } from 'vitest';

import {
  defineModelBase,
  defineModelState,
  defineExecutionReference,
  defineStartingInitializationRun,
  defineStartingTrainingRun,
  defineModelModification,
  ModelOperationKind,
  ModelRunResultKind,
  parseArtifactId,
  parseBaseId,
  parseCapabilityId,
  parseInitializerId,
  parseModificationId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  parseTrainerId,
  succeedInitializationRun,
  succeedTrainingRun,
  startModelRunExecution,
  updateModelRunProgress,
  type InitializationModelBase,
} from '@ta-agent/workbench-domain';

import { createMemoryPersistence, RunTransitionPersistenceError } from '../../src/index.js';

const slotEvidenceDigest = parseSha256Digest(`sha256:${'1'.repeat(64)}`);
const artifactDigest = parseSha256Digest(`sha256:${'2'.repeat(64)}`);

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
    const succeeded = succeedInitializationRun(running, baseId, { source: 'fixture' });

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
        run: succeedInitializationRun(running, parseBaseId('base:declared')),
        base: differentBase,
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
        run: succeedInitializationRun(running, baseId),
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
        run: succeedInitializationRun(running, baseId),
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
    const succeeded = succeedTrainingRun(starting, {
      kind: ModelRunResultKind.Modification,
      modificationId,
    });

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
        run: succeedTrainingRun(starting, {
          kind: ModelRunResultKind.Modification,
          modificationId,
        }),
        modification,
      })
    ).rejects.toBeInstanceOf(RunTransitionPersistenceError);
    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(starting);
    await expect(persistence.parameters.findModification(modificationId)).resolves.toBeUndefined();
  });
});

function runningRun() {
  return defineStartingInitializationRun({
    runId: parseRunId('run:1'),
    profileId: parseProfileId('research-model'),
    initializerId: parseInitializerId('import'),
    capabilityId: parseCapabilityId('initializer.import'),
    runtimeBindingId: parseRuntimeBindingId('runtime.local'),
    slotEvidenceDigest,
  });
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
  return defineStartingTrainingRun({
    runId: parseRunId('run:training'),
    profileId: parseProfileId('research-model'),
    trainerId: parseTrainerId('trainer:fixture'),
    capabilityId: parseCapabilityId('trainer.fixture'),
    runtimeBindingId: parseRuntimeBindingId('runtime.local'),
    slotEvidenceDigest,
    source: defineModelState({ baseId: 'base:source' }),
  });
}
