import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@print-an-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  ExecutionStatus,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExporterCapability,
  defineInitializerCapability,
  type ObserveExecution,
  type TypedExporterCapability,
} from '@print-an-agent/workbench-extension';
import {
  WorkbenchPersistenceError,
  createMemoryPersistence,
  createSharedProfilePersistenceAdapter,
} from '@print-an-agent/workbench-persistence';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@print-an-agent/workbench-setup';

import {
  ExportArtifactVerificationError,
  ExportCapabilityError,
  ModelStateAssetNotFoundError,
  createWorkbenchControlPlane,
  type ModelWorkbenchControlPlane,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

describe('Model Workbench export', () => {
  it('exports a materialized Model State into an immutable named Artifact Output', async () => {
    const exportModel = vi.fn<TypedExporterCapability<JsonValue>>((request) =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifacts: [exportedArtifact('tokenizer', 'c'), exportedArtifact('model', 'b')],
            data: { exported: request.input },
          },
        },
      })
    );
    const fixture = createExportFixture({ exportModel });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.exports.start({
        profileId: ProfileId,
        exporterId: ExporterId,
        source: { baseId: 'base:1' },
        input: { format: 'gguf' },
      })
    ).resolves.toEqual({ runId: 'run:2' });

    expect(exportModel).toHaveBeenCalledOnce();
    expect(exportModel.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run:2',
      source: {
        state: { baseId: 'base:1', modificationIds: [] },
        base: { baseId: 'base:1', artifact: { binding: { localObject: 'source' } } },
      },
      input: { format: 'gguf' },
    });
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      operation: 'export',
      status: 'succeeded',
      result: { kind: 'output', outputId: 'output:1', data: { exported: { format: 'gguf' } } },
    });
    await expect(
      fixture.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toMatchObject({
      profileId: ProfileId,
      artifacts: [
        {
          name: 'model',
          artifact: {
            artifactId: 'artifact:2',
            handoff: { receipt: { localObject: 'model' } },
          },
        },
        {
          name: 'tokenizer',
          artifact: {
            artifactId: 'artifact:3',
            handoff: { receipt: { localObject: 'tokenizer' } },
          },
        },
      ],
      lineage: {
        kind: 'export',
        runId: 'run:2',
        exporterId: ExporterId,
        source: { baseId: 'base:1', modificationIds: [] },
      },
    });
  });

  it('resumes an accepted Export execution and parses its observed terminal result', async () => {
    const observe = vi
      .fn<ObserveExecution>()
      .mockResolvedValueOnce({ status: ExecutionStatus.Running, progress: { stage: 'convert' } })
      .mockResolvedValueOnce({
        status: ExecutionStatus.Succeeded,
        result: { artifacts: [exportedArtifact('model', 'd')], data: { format: 'onnx' } },
      });
    const fixture = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Accepted,
          executionReceipt: { jobId: 'export:1' },
        }),
      observe,
    });
    await initializeSourceBase(fixture.workbench);
    await fixture.workbench.exports.start({
      profileId: ProfileId,
      exporterId: ExporterId,
      source: { baseId: 'base:1' },
      input: null,
    });

    await expect(
      fixture.workbench.runs.refresh({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'running',
      progress: { stage: 'convert' },
    });
    await expect(
      fixture.workbench.runs.wait(
        { profileId: ProfileId, runId: 'run:2' },
        { pollIntervalMilliseconds: 0 }
      )
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: { kind: 'output', outputId: 'output:1', data: { format: 'onnx' } },
    });
    await expect(
      fixture.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toMatchObject({
      artifacts: [{ name: 'model' }],
    });
  });

  it('records a failed Export Run before invocation when its source is unavailable', async () => {
    const exportModel = vi.fn<TypedExporterCapability<JsonValue>>();
    const fixture = createExportFixture({ exportModel });

    await expect(
      fixture.workbench.exports.start({
        profileId: ProfileId,
        exporterId: ExporterId,
        source: { baseId: 'base:missing' },
        input: null,
      })
    ).rejects.toBeInstanceOf(ModelStateAssetNotFoundError);
    expect(exportModel).not.toHaveBeenCalled();
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:1' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'EXPORT_SOURCE_PREPARATION_FAILED' },
    });
  });

  it('rejects and does not persist an Output when a produced Artifact fails verification', async () => {
    const fixture = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Succeeded,
            result: { artifacts: [exportedArtifact('invalid', 'e')] },
          },
        }),
      rejectArtifact: 'invalid',
    });
    await initializeSourceBase(fixture.workbench);

    await expect(
      fixture.workbench.exports.start({
        profileId: ProfileId,
        exporterId: ExporterId,
        source: { baseId: 'base:1' },
        input: null,
      })
    ).rejects.toBeInstanceOf(ExportArtifactVerificationError);
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'EXPORT_ARTIFACT_VERIFICATION_FAILED' },
    });
    await expect(
      fixture.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
  });

  it('records a Capability invocation error without accepting an Output', async () => {
    const backendError = new Error('Fixture Exporter failed before dispatch.');
    const fixture = createExportFixture({
      exportModel: () => Promise.reject(backendError),
    });
    await initializeSourceBase(fixture.workbench);

    await expect(startExport(fixture.workbench)).rejects.toMatchObject({
      name: ExportCapabilityError.name,
      cause: backendError,
    });
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'EXPORT_CAPABILITY_FAILED' },
    });
    await expect(
      fixture.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
  });

  it('rejects a malformed observed result and records the Export Run failure', async () => {
    const fixture = createExportFixture({
      exportModel: acceptedExport,
      observe: unsafeObserve(() =>
        Promise.resolve({
          status: ExecutionStatus.Succeeded,
          result: { artifacts: [] },
        })
      ),
    });
    await initializeSourceBase(fixture.workbench);
    await startExport(fixture.workbench);

    await expect(
      fixture.workbench.runs.refresh({ profileId: ProfileId, runId: 'run:2' })
    ).rejects.toBeInstanceOf(ExportCapabilityError);
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'EXPORT_OBSERVED_RESULT_INVALID' },
    });
  });

  it('preserves failed, cancelled, and lost terminal outcomes without accepting Outputs', async () => {
    const failed = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Failed,
            failure: {
              code: 'BACKEND_EXPORT_FAILED',
              message: 'Fixture backend rejected the export.',
              retryable: true,
            },
          },
        }),
    });
    await initializeSourceBase(failed.workbench);
    await expect(startExport(failed.workbench)).resolves.toEqual({ runId: 'run:2' });
    await expect(
      failed.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'BACKEND_EXPORT_FAILED', retryable: true },
    });

    const cancelled = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: { status: ExecutionStatus.Cancelled, reason: 'requested' },
        }),
    });
    await initializeSourceBase(cancelled.workbench);
    await startExport(cancelled.workbench);
    await expect(
      cancelled.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'requested',
    });

    const lost = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Lost,
            failure: {
              code: 'BACKEND_EXPORT_LOST',
              message: 'Fixture backend lost the export job.',
              retryable: true,
            },
          },
        }),
    });
    await initializeSourceBase(lost.workbench);
    await startExport(lost.workbench);
    await expect(
      lost.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      status: 'lost',
      failure: { code: 'BACKEND_EXPORT_LOST' },
    });

    await expect(
      failed.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
    await expect(
      cancelled.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
    await expect(
      lost.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
  });

  it('preserves persistence failures without misclassifying them as Export failures', async () => {
    const persistenceError = new WorkbenchPersistenceError(
      'FIXTURE_EXPORT_COMMIT_FAILED',
      'Fixture Export storage is unavailable.'
    );
    const fixture = createExportFixture({
      exportModel: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Succeeded,
            result: { artifacts: [exportedArtifact('model', 'f')] },
          },
        }),
      exportCommitFailure: persistenceError,
    });
    await initializeSourceBase(fixture.workbench);

    await expect(startExport(fixture.workbench)).rejects.toBe(persistenceError);
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:2' })
    ).resolves.toMatchObject({
      operation: 'export',
      status: 'starting',
    });
    await expect(
      fixture.workbench.outputs.get({ profileId: ProfileId, outputId: 'output:1' })
    ).resolves.toBeUndefined();
  });
});

const ProfileId = 'research-model';
const ExporterId = 'gguf';
const ArtifactSupportId = 'artifacts.local';

interface ExportFixtureInput {
  readonly exportModel: TypedExporterCapability<JsonValue>;
  readonly observe?: ObserveExecution;
  readonly rejectArtifact?: string;
  readonly exportCommitFailure?: WorkbenchPersistenceError;
}

function createExportFixture(input: ExportFixtureInput) {
  const persistence = createMemoryPersistence();
  const exportCommitFailure = input.exportCommitFailure;
  const configuredPersistence =
    exportCommitFailure === undefined
      ? persistence
      : Object.freeze({
          ...persistence,
          commits: Object.freeze({
            ...persistence.commits,
            export: Object.freeze({
              commit: () => Promise.reject(exportCommitFailure),
            }),
          }),
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
          exporters: [
            {
              exporterId: ExporterId,
              capabilityId: 'exporter.fixture',
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
        defineExporterCapability({
          capabilityId: 'exporter.fixture',
          input: JsonValueContract,
          export: input.exportModel,
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: ArtifactSupportId,
          verify: ({ artifact }) =>
            artifact.handoff.receipt !== null &&
            typeof artifact.handoff.receipt === 'object' &&
            'localObject' in artifact.handoff.receipt &&
            artifact.handoff.receipt.localObject === input.rejectArtifact
              ? Promise.reject(new Error('Fixture verification failed.'))
              : Promise.resolve(),
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'execution.local',
          observe: input.observe ?? vi.fn(),
          cancel: vi.fn(),
        }),
      ],
    }
  );
  return {
    workbench: createWorkbenchControlPlane({
      setup,
      persistence: createSharedProfilePersistenceAdapter(configuredPersistence),
      idSource: sequentialIdSource(),
      clock: { now: () => '2026-08-24T10:00:00.000Z' },
    }),
  };
}

function startExport(workbench: ModelWorkbenchControlPlane) {
  return workbench.exports.start({
    profileId: ProfileId,
    exporterId: ExporterId,
    source: { baseId: 'base:1' },
    input: null,
  });
}

function acceptedExport() {
  return Promise.resolve({
    kind: CapabilityDispatchKind.Accepted,
    executionReceipt: { jobId: 'export:accepted' },
  } as const);
}

function unsafeObserve(observe: () => Promise<unknown>): ObserveExecution {
  return observe as ObserveExecution;
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

function exportedArtifact(name: string, digestSeed: string) {
  return {
    name,
    artifact: {
      digest: `sha256:${digestSeed.repeat(64)}`,
      receipt: { localObject: name },
    },
  };
}
