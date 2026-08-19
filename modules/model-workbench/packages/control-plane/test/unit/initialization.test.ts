import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@ta-agent/workbench-domain';

import {
  CapabilityDispatchKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  ExecutionStatus,
  JsonValueContract,
  type CancelExecution,
  type ObserveExecution,
  type TypedInitializerCapability,
  type VerifyArtifact,
} from '@ta-agent/workbench-extension';
import { createMemoryPersistence } from '@ta-agent/workbench-persistence';
import { resolveWorkbenchSetup, RuntimeBindingKind } from '@ta-agent/workbench-setup';

import {
  createWorkbenchControlPlane,
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
  InitializerSlotNotFoundError,
  ModelProfileNotFoundError,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

describe('Model Workbench initialization', () => {
  it('accepts an immediately completed result and records a queryable Base with lineage', async () => {
    const initialize = vi.fn(() => Promise.resolve(completedSuccess({ imported: true })));
    const verifyArtifact = vi.fn<VerifyArtifact>(() => Promise.resolve());
    const nextId = vi.fn(idForKind);
    const workbench = createWorkbench({ initialize, verifyArtifact, nextId });

    await expect(
      workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'import',
        input: { source: 'fixture://base' },
      })
    ).resolves.toEqual({ runId: 'run:1' });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'initialization',
        runId: 'run:1',
        input: { source: 'fixture://base' },
      }),
      undefined
    );
    expect(verifyArtifact).toHaveBeenCalledWith(
      {
        artifact: {
          artifactId: 'artifact:1',
          digest: `sha256:${'a'.repeat(64)}`,
          handoff: {
            runtimeSupportId: 'artifacts.local',
            receipt: { location: 'fixture://initialized-parameters' },
          },
        },
      },
      undefined
    );
    expect(nextId.mock.calls.map(([kind]) => kind)).toEqual(['run', 'artifact', 'base']);
    await expect(
      workbench.runs.wait('run:1', { pollIntervalMilliseconds: 0 })
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: { kind: 'base', baseId: 'base:1', data: { imported: true } },
    });
    await expect(workbench.models.getBase('base:1')).resolves.toMatchObject({
      baseId: 'base:1',
      artifact: {
        artifactId: 'artifact:1',
        handoff: {
          runtimeSupportId: 'artifacts.local',
          receipt: { location: 'fixture://initialized-parameters' },
        },
      },
      lineage: {
        runId: 'run:1',
        initializerId: 'import',
        capabilityId: 'initializer.import',
        runtimeBindingId: 'runtime.local',
      },
    });
  });

  it('persists an accepted execution receipt and verifies the same result through observation', async () => {
    const verifyArtifact = vi.fn<VerifyArtifact>(() => Promise.resolve());
    const observe = vi
      .fn<ObserveExecution>()
      .mockResolvedValueOnce({ status: ExecutionStatus.Running, progress: { step: 3 } })
      .mockResolvedValueOnce({
        status: ExecutionStatus.Succeeded,
        result: initializationResult({ imported: true }, 'b'),
      });
    const workbench = createWorkbench({
      initialize: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Accepted,
          executionReceipt: { jobId: 'job:remote:1', token: 'opaque' },
        }),
      observe,
      verifyArtifact,
    });

    await expect(
      workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'import',
        input: null,
      })
    ).resolves.toEqual({ runId: 'run:1' });
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'running',
      execution: {
        runtimeSupportId: 'execution.local',
        receipt: { jobId: 'job:remote:1', token: 'opaque' },
      },
    });
    await expect(workbench.runs.refresh('run:1')).resolves.toMatchObject({
      status: 'running',
      progress: { step: 3 },
    });
    await expect(
      workbench.runs.wait('run:1', { pollIntervalMilliseconds: 0 })
    ).resolves.toMatchObject({ status: 'succeeded', result: { baseId: 'base:1' } });
    expect(verifyArtifact).toHaveBeenCalledWith(
      {
        artifact: {
          artifactId: 'artifact:1',
          digest: `sha256:${'b'.repeat(64)}`,
          handoff: {
            runtimeSupportId: 'artifacts.local',
            receipt: { location: 'fixture://initialized-parameters' },
          },
        },
      },
      undefined
    );
    await expect(workbench.models.getBase('base:1')).resolves.toMatchObject({
      artifact: {
        digest: `sha256:${'b'.repeat(64)}`,
        handoff: {
          runtimeSupportId: 'artifacts.local',
          receipt: { location: 'fixture://initialized-parameters' },
        },
      },
    });
    expect(observe).toHaveBeenNthCalledWith(
      1,
      { executionReceipt: { jobId: 'job:remote:1', token: 'opaque' } },
      undefined
    );
    await workbench.runs.refresh('run:1');
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('records Capability-declared failure, cancellation, and loss as terminal Runs', async () => {
    const nextId = vi.fn(idForKind);
    const failureWorkbench = createWorkbench({
      initialize: () =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Failed,
            failure: {
              code: 'SOURCE_MISSING',
              message: 'The requested source does not exist.',
              retryable: false,
            },
          },
        }),
      nextId,
    });
    await failureWorkbench.initialization.start({
      profileId: 'research-model',
      initializerId: 'import',
      input: null,
    });
    await expect(failureWorkbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'SOURCE_MISSING' },
    });
    expect(nextId).toHaveBeenCalledOnce();
    expect(nextId).toHaveBeenCalledWith('run');

    const cancelledWorkbench = createAcceptedWorkbench({
      status: ExecutionStatus.Cancelled,
      reason: { requestedBy: 'user' },
    });
    await start(cancelledWorkbench);
    await expect(cancelledWorkbench.runs.refresh('run:1')).resolves.toMatchObject({
      status: 'cancelled',
      reason: { requestedBy: 'user' },
    });

    const lostWorkbench = createAcceptedWorkbench({
      status: ExecutionStatus.Lost,
      failure: { code: 'EXECUTION_MISSING', message: 'Job disappeared.', retryable: true },
    });
    await start(lostWorkbench);
    await expect(lostWorkbench.runs.refresh('run:1')).resolves.toMatchObject({
      status: 'lost',
      failure: { code: 'EXECUTION_MISSING' },
    });
  });

  it('cancels only through an explicit call and does not treat stopping wait as cancellation', async () => {
    const cancel = vi.fn<CancelExecution>(() => Promise.resolve());
    const observe = vi.fn<ObserveExecution>(() =>
      Promise.resolve({ status: ExecutionStatus.Running, progress: { step: 1 } })
    );
    const workbench = createWorkbench({
      initialize: acceptedInitialization,
      observe,
      cancel,
    });
    await start(workbench);

    const controller = new AbortController();
    controller.abort('caller stopped waiting');
    await expect(
      workbench.runs.wait('run:1', {
        signal: controller.signal,
        pollIntervalMilliseconds: 0,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).not.toHaveBeenCalled();

    await expect(workbench.runs.cancel('run:1')).resolves.toBe('run:1');
    expect(cancel).toHaveBeenCalledWith({ executionReceipt: { jobId: 'job:1' } }, undefined);
  });

  it('records malformed Capability output but surfaces it as a protocol error', async () => {
    const workbench = createWorkbench({
      initialize: unsafeInitializer(() => Promise.resolve({ status: 'maybe' })),
    });

    await expect(start(workbench)).rejects.toBeInstanceOf(InitializationCapabilityError);
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'INITIALIZATION_CAPABILITY_FAILED' },
    });
  });

  it('rejects Capability output that attempts to declare Workbench-owned Artifact identity', async () => {
    const workbench = createWorkbench({
      initialize: unsafeInitializer(() =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Succeeded,
            result: {
              artifact: {
                digest: `sha256:${'a'.repeat(64)}`,
                receipt: { location: 'fixture://artifact' },
                artifactId: 'artifact:unexpected',
              },
            },
          },
        })
      ),
    });

    await expect(start(workbench)).rejects.toBeInstanceOf(InitializationCapabilityError);
    await expect(workbench.models.getBase('base:1')).resolves.toBeUndefined();
  });

  it('records Runtime Support verification failure and does not accept the Base', async () => {
    const verificationFailure = new Error('Fixture Artifact cannot be verified.');
    const workbench = createWorkbench({
      initialize: () => Promise.resolve(completedSuccess()),
      verifyArtifact: () => Promise.reject(verificationFailure),
    });

    await expect(start(workbench)).rejects.toMatchObject({
      name: InitializationArtifactVerificationError.name,
      cause: verificationFailure,
    });
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'INITIALIZATION_ARTIFACT_VERIFICATION_FAILED' },
    });
    await expect(workbench.models.getBase('base:1')).resolves.toBeUndefined();
  });

  it('rejects unknown Profile and Initializer selections before creating a Run', async () => {
    const workbench = createWorkbench({ initialize: vi.fn() });

    await expect(
      workbench.initialization.start({
        profileId: 'unknown',
        initializerId: 'import',
        input: null,
      })
    ).rejects.toBeInstanceOf(ModelProfileNotFoundError);
    await expect(
      workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'unknown',
        input: null,
      })
    ).rejects.toBeInstanceOf(InitializerSlotNotFoundError);
    await expect(workbench.runs.get('run:1')).resolves.toBeUndefined();
  });
});

interface WorkbenchFixture {
  readonly initialize: TypedInitializerCapability<JsonValue>;
  readonly verifyArtifact?: VerifyArtifact;
  readonly observe?: ObserveExecution;
  readonly cancel?: CancelExecution;
  readonly nextId?: (kind: WorkbenchGeneratedIdKind) => string;
}

function unsafeInitializer(
  initialize: () => Promise<unknown>
): TypedInitializerCapability<JsonValue> {
  return initialize as TypedInitializerCapability<JsonValue>;
}

function createWorkbench({
  initialize,
  verifyArtifact = () => Promise.resolve(),
  observe = vi.fn(),
  cancel = vi.fn(),
  nextId = idForKind,
}: WorkbenchFixture) {
  const setup = resolveWorkbenchSetup(
    {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.local',
          supports: {
            artifactHandoffId: 'artifacts.local',
            executionSupportId: 'execution.local',
          },
        },
      ],
      profiles: [
        {
          profileId: 'research-model',
          initializers: [
            {
              initializerId: 'import',
              capabilityId: 'initializer.import',
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
          metadata: { modelFramework: 'fixture' },
          input: JsonValueContract,
          initialize,
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.local',
          verify: verifyArtifact,
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({ runtimeSupportId: 'execution.local', observe, cancel }),
      ],
    }
  );
  return createWorkbenchControlPlane({
    setup,
    persistence: createMemoryPersistence(),
    idSource: { nextId },
  });
}

function idForKind(kind: WorkbenchGeneratedIdKind): string {
  return {
    run: 'run:1',
    base: 'base:1',
    modification: 'modification:1',
    artifact: 'artifact:1',
  }[kind];
}

function completedSuccess(data?: JsonValue) {
  return {
    kind: CapabilityDispatchKind.Completed,
    terminal: {
      status: ExecutionStatus.Succeeded,
      result: initializationResult(data),
    },
  };
}

function initializationResult(data?: JsonValue, digestSeed = 'a') {
  return {
    artifact: {
      digest: `sha256:${digestSeed.repeat(64)}`,
      receipt: { location: 'fixture://initialized-parameters' },
    },
    ...(data === undefined ? {} : { data }),
  };
}

function acceptedInitialization() {
  return Promise.resolve({
    kind: CapabilityDispatchKind.Accepted,
    executionReceipt: { jobId: 'job:1' },
  });
}

function createAcceptedWorkbench(observation: Awaited<ReturnType<ObserveExecution>>) {
  return createWorkbench({
    initialize: acceptedInitialization,
    observe: () => Promise.resolve(observation),
  });
}

function start(workbench: ReturnType<typeof createWorkbench>) {
  return workbench.initialization.start({
    profileId: 'research-model',
    initializerId: 'import',
    input: null,
  });
}
