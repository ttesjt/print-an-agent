import { describe, expect, it, vi } from 'vitest';

import {
  CapabilityDispatchKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  defineTrainerCapability,
  ExecutionStatus,
  JsonValueContract,
  type CancelExecution,
  type ObserveExecution,
  type TypedTrainerCapability,
} from '@ta-agent/workbench-extension';
import type { JsonValue } from '@ta-agent/workbench-domain';
import { ModelRunResultKind } from '@ta-agent/workbench-domain';
import {
  createMemoryPersistence,
  createSharedProfilePersistenceAdapter,
  WorkbenchPersistenceError,
} from '@ta-agent/workbench-persistence';
import { resolveWorkbenchSetup, RuntimeBindingKind } from '@ta-agent/workbench-setup';

import {
  createWorkbenchControlPlane,
  ModelStateAssetNotFoundError,
  type ModelWorkbenchControlPlane,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

describe('Model Workbench training', () => {
  it('trains a materialized Model State into an additive Modification with exact lineage', async () => {
    const train = vi.fn<TypedTrainerCapability<JsonValue>>((request) =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            assetKind: ModelRunResultKind.Modification,
            artifact: trainedArtifact('modification'),
            data: { trained: request.input },
          },
        },
      })
    );
    const fixture = createTrainingFixture({ train });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.training.start({
        profileId: ProfileId,
        trainerId: TrainerId,
        source: { baseId: 'base:1' },
        input: { epochs: 2 },
      })
    ).resolves.toEqual({ runId: 'run:2' });

    expect(train).toHaveBeenCalledOnce();
    const call = train.mock.calls[0];
    if (call === undefined) throw new Error('Expected one Trainer Capability call.');
    expect(call[0]).toMatchObject({
      runId: 'run:2',
      source: {
        state: { baseId: 'base:1', modificationIds: [] },
        base: { baseId: 'base:1' },
        modifications: [],
      },
      input: { epochs: 2 },
    });
    expect(call[0].source.base.artifact.binding).toEqual({
      receipt: { localObject: 'source' },
    });
    expect(call[1]).toBeUndefined();
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      operation: 'training',
      status: 'succeeded',
      source: { baseId: 'base:1', modificationIds: [] },
      result: { kind: 'modification', modificationId: 'modification:1' },
    });
    await expect(
      fixture.workbench.models.getModification({
        profileId: ProfileId,
        modificationId: 'modification:1',
      })
    ).resolves.toMatchObject({
      profileId: ProfileId,
      artifact: {
        artifactId: 'artifact:2',
        handoff: {
          runtimeSupportId: ArtifactSupportId,
          receipt: { localObject: 'modification' },
        },
      },
      lineage: {
        kind: 'training',
        runId: 'run:2',
        trainerId: TrainerId,
        source: { baseId: 'base:1', modificationIds: [] },
      },
    });
    expect(
      fixture.workbench.models.compose({
        baseId: 'base:1',
        modificationIds: ['modification:1'],
      })
    ).toMatchObject({ baseId: 'base:1', modificationIds: ['modification:1'] });
  });

  it('resumes an accepted Training execution through progress to a new Base', async () => {
    const train = vi.fn<TypedTrainerCapability<JsonValue>>(() =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Accepted,
        executionReceipt: { jobId: 'training:1' },
      })
    );
    const observe = vi
      .fn<ObserveExecution>()
      .mockResolvedValueOnce({ status: ExecutionStatus.Running, progress: { step: 3 } })
      .mockResolvedValueOnce({
        status: ExecutionStatus.Succeeded,
        result: {
          assetKind: ModelRunResultKind.Base,
          artifact: trainedArtifact('full-fine-tune'),
          data: { steps: 4 },
        },
      });
    const fixture = createTrainingFixture({ train, observe });
    await initializeSourceBase(fixture.workbench);

    await fixture.workbench.training.start({
      profileId: ProfileId,
      trainerId: TrainerId,
      source: { baseId: 'base:1' },
      input: { steps: 4 },
    });

    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'running',
      execution: { receipt: { jobId: 'training:1' } },
    });
    await expect(
      fixture.workbench.runs.refresh({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'running',
      progress: { step: 3 },
    });
    await expect(
      fixture.workbench.runs.wait(
        { profileId: ProfileId, runId: 'run:2' },
        { pollIntervalMilliseconds: 0 }
      )
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: { kind: 'base', baseId: 'base:2', data: { steps: 4 } },
    });
    await expect(
      fixture.workbench.models.getBase({ profileId: ProfileId, baseId: 'base:2' })
    ).resolves.toMatchObject({
      profileId: ProfileId,
      lineage: {
        kind: 'training',
        runId: 'run:2',
        source: { baseId: 'base:1', modificationIds: [] },
      },
    });
  });

  it('routes cancellation and terminal cancellation through the Training execution support', async () => {
    const cancel = vi.fn<CancelExecution>(() => Promise.resolve());
    const fixture = createTrainingFixture({
      train: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Accepted,
          executionReceipt: { jobId: 'training:cancelled' },
        }),
      observe: () => Promise.resolve({ status: ExecutionStatus.Cancelled, reason: 'requested' }),
      cancel,
    });
    await initializeSourceBase(fixture.workbench);
    await fixture.workbench.training.start({
      profileId: ProfileId,
      trainerId: TrainerId,
      source: { baseId: 'base:1' },
      input: null,
    });

    await expect(
      fixture.workbench.runs.cancel({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toBe('run:2');
    expect(cancel).toHaveBeenCalledWith(
      { profileId: ProfileId, executionReceipt: { jobId: 'training:cancelled' } },
      undefined
    );
    await expect(
      fixture.workbench.runs.refresh({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'requested',
    });
  });

  it('records a Trainer execution failure without accepting a parameter asset', async () => {
    const fixture = createTrainingFixture({
      train: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Failed,
            failure: {
              code: 'BACKEND_TRAINING_FAILED',
              message: 'Fixture backend rejected the training request.',
              retryable: true,
            },
          },
        }),
    });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.training.start({
        profileId: ProfileId,
        trainerId: TrainerId,
        source: { baseId: 'base:1' },
        input: null,
      })
    ).resolves.toEqual({ runId: 'run:2' });
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'BACKEND_TRAINING_FAILED', retryable: true },
    });
    await expect(
      fixture.workbench.models.getBase({ profileId: ProfileId, baseId: 'base:2' })
    ).resolves.toBeUndefined();
    await expect(
      fixture.workbench.models.getModification({
        profileId: ProfileId,
        modificationId: 'modification:1',
      })
    ).resolves.toBeUndefined();
  });

  it('records a failed Training Run when its source parameter asset is missing', async () => {
    const train = vi.fn<TypedTrainerCapability<JsonValue>>();
    const fixture = createTrainingFixture({ train });

    await expect(
      fixture.workbench.training.start({
        profileId: ProfileId,
        trainerId: TrainerId,
        source: { baseId: 'base:missing' },
        input: null,
      })
    ).rejects.toBeInstanceOf(ModelStateAssetNotFoundError);
    expect(train).not.toHaveBeenCalled();
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:1' })
    ).resolves.toMatchObject({
      operation: 'training',
      status: 'failed',
      failure: { code: 'TRAINING_SOURCE_PREPARATION_FAILED' },
    });
  });

  it('records source persistence failure and preserves the infrastructure error', async () => {
    const persistenceError = new WorkbenchPersistenceError(
      'FIXTURE_PARAMETER_READ_FAILED',
      'Fixture parameter storage is unavailable.'
    );
    const fixture = createTrainingFixture({
      train: vi.fn<TypedTrainerCapability<JsonValue>>(),
      findBaseFailure: persistenceError,
    });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.training.start({
        profileId: ProfileId,
        trainerId: TrainerId,
        source: { baseId: 'base:1' },
        input: null,
      })
    ).rejects.toBe(persistenceError);
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'TRAINING_SOURCE_PREPARATION_FAILED' },
    });
  });

  it('preserves AbortError when Trainer invocation is aborted after Run creation', async () => {
    const abortError = new Error('Fixture Trainer invocation aborted.');
    abortError.name = 'AbortError';
    const fixture = createTrainingFixture({
      train: () => Promise.reject(abortError),
    });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.training.start({
        profileId: ProfileId,
        trainerId: TrainerId,
        source: { baseId: 'base:1' },
        input: null,
      })
    ).rejects.toBe(abortError);
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'TRAINING_ABORTED' },
    });
  });
});

const ProfileId = 'research-model';
const TrainerId = 'fine-tune';
const ArtifactSupportId = 'artifacts.local';

interface TrainingFixtureInput {
  readonly train: TypedTrainerCapability<JsonValue>;
  readonly observe?: ObserveExecution;
  readonly cancel?: CancelExecution;
  readonly findBaseFailure?: WorkbenchPersistenceError;
}

function createTrainingFixture(input: TrainingFixtureInput) {
  const artifactSupport = defineArtifactHandoffSupport({
    runtimeSupportId: ArtifactSupportId,
    verify: () => Promise.resolve(),
    materialize: ({ artifact }) => Promise.resolve({ receipt: artifact.handoff.receipt }),
  });
  const setup = resolveWorkbenchSetup(
    {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.local',
          supports: {
            artifactHandoffId: ArtifactSupportId,
            executionSupportId: 'execution.local',
          },
        },
      ],
      profiles: [
        {
          profileId: ProfileId,
          initializers: [
            {
              initializerId: 'import',
              capabilityId: 'initializer.import',
              runtimeBindingId: 'runtime.local',
            },
          ],
          trainers: [
            {
              trainerId: TrainerId,
              capabilityId: 'trainer.fixture',
              runtimeBindingId: 'runtime.local',
            },
          ],
        },
      ],
    },
    {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'initializer.import',
          input: JsonValueContract,
          initialize: () =>
            Promise.resolve({
              kind: CapabilityDispatchKind.Completed,
              terminal: {
                status: ExecutionStatus.Succeeded,
                result: { artifact: sourceArtifact() },
              },
            }),
        }),
        defineTrainerCapability({
          capabilityId: 'trainer.fixture',
          input: JsonValueContract,
          train: input.train,
        }),
      ],
      runtimeSupports: [
        artifactSupport,
        defineExecutionSupport({
          runtimeSupportId: 'execution.local',
          observe: input.observe ?? vi.fn(),
          cancel: input.cancel ?? vi.fn(),
        }),
      ],
    }
  );
  const memoryPersistence = createMemoryPersistence();
  const findBaseFailure = input.findBaseFailure;
  const persistence =
    findBaseFailure === undefined
      ? memoryPersistence
      : Object.freeze({
          ...memoryPersistence,
          parameters: Object.freeze({
            ...memoryPersistence.parameters,
            findBase: () => Promise.reject(findBaseFailure),
          }),
        });
  return {
    workbench: createWorkbenchControlPlane({
      setup,
      persistence: createSharedProfilePersistenceAdapter(persistence),
      idSource: sequentialIdSource(),
    }),
  };
}

function sequentialIdSource() {
  const counts: Record<WorkbenchGeneratedIdKind, number> = {
    run: 0,
    base: 0,
    modification: 0,
    output: 0,
    artifact: 0,
  };
  return Object.freeze({
    nextId(kind: WorkbenchGeneratedIdKind): string {
      counts[kind] += 1;
      return `${kind}:${String(counts[kind])}`;
    },
  });
}

async function initializeSourceBase(workbench: ModelWorkbenchControlPlane): Promise<void> {
  await workbench.initialization.start({
    profileId: ProfileId,
    initializerId: 'import',
    input: null,
  });
}

function sourceArtifact() {
  return {
    digest: `sha256:${'a'.repeat(64)}`,
    receipt: { localObject: 'source' },
  } as const;
}

function trainedArtifact(localObject: string) {
  return {
    digest: `sha256:${'b'.repeat(64)}`,
    receipt: { localObject },
  } as const;
}
