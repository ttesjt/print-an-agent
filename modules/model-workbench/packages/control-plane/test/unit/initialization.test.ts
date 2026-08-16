import { describe, expect, it, vi } from 'vitest';

import {
  JsonValueContract,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
  type InitializationCapabilityRequest,
  type VerifyArtifact,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@ta-agent/workbench-setup';
import { createMemoryPersistence } from '@ta-agent/workbench-persistence';

import {
  createWorkbenchControlPlane,
  InitializationArtifactMismatchError,
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
  InitializerSlotNotFoundError,
  ModelProfileNotFoundError,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

describe('Model Workbench initialization', () => {
  it('calls the selected Capability and records a queryable Base with lineage', async () => {
    const initialize = vi.fn((request: { readonly plannedArtifactId: string }) =>
      Promise.resolve({
        status: 'succeeded',
        artifact: {
          artifactId: request.plannedArtifactId,
          digest: `sha256:${'a'.repeat(64)}`,
        },
        data: { imported: true },
      })
    );
    const verifyArtifact = vi.fn(() => Promise.resolve());
    const workbench = createWorkbench(initialize, verifyArtifact);

    const result = await workbench.initialization.start({
      profileId: 'research-model',
      initializerId: 'import',
      input: { source: 'fixture://base' },
    });

    expect(result).toEqual({ status: 'succeeded', runId: 'run:1', baseId: 'base:1' });
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'initialization',
        runId: 'run:1',
        plannedArtifactId: 'artifact:1',
        input: { source: 'fixture://base' },
      }),
      undefined
    );
    expect(verifyArtifact).toHaveBeenCalledWith(
      {
        artifact: {
          artifactId: 'artifact:1',
          digest: `sha256:${'a'.repeat(64)}`,
        },
      },
      undefined
    );
    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(
      verifyArtifact.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'succeeded',
      capabilityId: 'initializer.import',
      runtimeBindingId: 'runtime.local',
      result: { kind: 'base', baseId: 'base:1', data: { imported: true } },
    });
    await expect(workbench.models.getBase('base:1')).resolves.toMatchObject({
      baseId: 'base:1',
      artifact: { artifactId: 'artifact:1' },
      lineage: {
        runId: 'run:1',
        initializerId: 'import',
        capabilityId: 'initializer.import',
        runtimeBindingId: 'runtime.local',
      },
    });
  });

  it('records a Capability-declared failure as a terminal Run', async () => {
    const workbench = createWorkbench(() =>
      Promise.resolve({
        status: 'failed',
        failure: {
          code: 'SOURCE_MISSING',
          message: 'The requested source does not exist.',
          retryable: false,
        },
      })
    );

    const result = await workbench.initialization.start({
      profileId: 'research-model',
      initializerId: 'import',
      input: null,
    });

    expect(result).toMatchObject({
      status: 'failed',
      runId: 'run:1',
      failure: { code: 'SOURCE_MISSING' },
    });
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'SOURCE_MISSING' },
    });
    await expect(workbench.models.getBase('base:1')).resolves.toBeUndefined();
  });

  it('records malformed Capability output but surfaces it as a protocol error', async () => {
    const workbench = createWorkbench(() => Promise.resolve({ status: 'maybe' }));

    await expect(
      workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'import',
        input: null,
      })
    ).rejects.toBeInstanceOf(InitializationCapabilityError);
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'INITIALIZATION_CAPABILITY_FAILED' },
    });
  });

  it('rejects an Artifact that does not match the Workbench-planned identity', async () => {
    const workbench = createWorkbench(() =>
      Promise.resolve({
        status: 'succeeded',
        artifact: {
          artifactId: 'artifact:unexpected',
          digest: `sha256:${'a'.repeat(64)}`,
        },
      })
    );

    try {
      await workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'import',
        input: null,
      });
      expect.fail('Expected initialization to reject the mismatched Artifact identity.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InitializationCapabilityError);
      if (!(error instanceof InitializationCapabilityError)) throw error;
      expect(error.cause).toBeInstanceOf(InitializationArtifactMismatchError);
    }
    await expect(workbench.models.getBase('base:1')).resolves.toBeUndefined();
  });

  it('records Runtime Support verification failure and does not accept the Base', async () => {
    const verifyFailure = new Error('Fixture Artifact bytes do not match their digest.');
    const workbench = createWorkbench(
      ({ plannedArtifactId }) =>
        Promise.resolve({
          status: 'succeeded',
          artifact: {
            artifactId: plannedArtifactId,
            digest: `sha256:${'a'.repeat(64)}`,
          },
        }),
      () => Promise.reject(verifyFailure)
    );

    try {
      await workbench.initialization.start({
        profileId: 'research-model',
        initializerId: 'import',
        input: null,
      });
      expect.fail('Expected Artifact verification to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InitializationArtifactVerificationError);
      if (!(error instanceof InitializationArtifactVerificationError)) throw error;
      expect(error.cause).toBe(verifyFailure);
    }
    await expect(workbench.runs.get('run:1')).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'INITIALIZATION_ARTIFACT_VERIFICATION_FAILED' },
    });
    await expect(workbench.models.getBase('base:1')).resolves.toBeUndefined();
  });

  it('rejects an unknown Profile before creating a Run', async () => {
    const workbench = createWorkbench(vi.fn());

    await expect(
      workbench.initialization.start({
        profileId: 'unknown',
        initializerId: 'import',
        input: null,
      })
    ).rejects.toBeInstanceOf(ModelProfileNotFoundError);
    await expect(workbench.runs.get('run:1')).resolves.toBeUndefined();
  });

  it('rejects an unknown Initializer before creating a Run', async () => {
    const workbench = createWorkbench(vi.fn());

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

function createWorkbench(
  initialize: (request: InitializationCapabilityRequest) => Promise<unknown>,
  verifyArtifact: VerifyArtifact = () => Promise.resolve()
) {
  const setup = resolveWorkbenchSetup(
    {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.local',
          supports: { artifactVerifierId: 'artifacts.local' },
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
        defineArtifactVerifierSupport({
          runtimeSupportId: 'artifacts.local',
          verify: verifyArtifact,
        }),
      ],
    }
  );
  const ids: Record<WorkbenchGeneratedIdKind, string> = {
    run: 'run:1',
    base: 'base:1',
    artifact: 'artifact:1',
  };
  return createWorkbenchControlPlane({
    setup,
    persistence: createMemoryPersistence(),
    idSource: { nextId: (kind) => ids[kind] },
  });
}
