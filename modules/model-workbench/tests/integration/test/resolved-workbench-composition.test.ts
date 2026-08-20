import { describe, expect, it, vi } from 'vitest';

import { createWorkbenchControlPlane } from '@ta-agent/workbench-control-plane';
import {
  CapabilityDispatchKind,
  JsonSchemaDialect,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  defineJsonSchemaContract,
  ExecutionStatus,
} from '@ta-agent/workbench-extension';
import {
  createMemoryPersistence,
  createSharedProfilePersistenceAdapter,
} from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@ta-agent/workbench-setup';

describe('resolved Workbench composition', () => {
  it('runs one governed Capability plus Runtime Support operation through both layers', async () => {
    const initializeBackend = vi.fn((request: { readonly input: { readonly source: string } }) =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifact: {
              digest: `sha256:${'c'.repeat(64)}`,
              receipt: { location: 'fixture://initialized-parameters' },
            },
            data: { importedFrom: request.input.source },
          },
        },
      })
    );
    const verifyArtifact = vi.fn(() => Promise.resolve());
    const inputContract = defineJsonSchemaContract({
      schema: {
        $schema: JsonSchemaDialect.Draft202012,
        type: 'object',
        required: ['source'],
        properties: { source: { type: 'string' } },
        additionalProperties: false,
      } as const,
    });
    const resultContract = defineJsonSchemaContract({
      schema: {
        $schema: JsonSchemaDialect.Draft202012,
        type: 'object',
        required: ['importedFrom'],
        properties: { importedFrom: { type: 'string' } },
        additionalProperties: false,
      } as const,
    });
    const extensionResources = {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'models.import',
          input: inputContract,
          resultData: resultContract,
          initialize: initializeBackend,
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.fixture',
          verify: verifyArtifact,
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'execution.fixture',
          observe: vi.fn(),
          cancel: vi.fn(),
        }),
      ],
    };
    const setupInput = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.fixture',
          supports: {
            artifactHandoffId: 'artifacts.fixture',
            executionSupportId: 'execution.fixture',
          },
        },
      ],
      profiles: [
        {
          profileId: 'research-model',
          initializers: [
            {
              initializerId: 'import',
              capabilityId: 'models.import',
              runtimeBindingId: 'runtime.fixture',
            },
          ],
        },
      ],
    };
    const setup = resolveWorkbenchSetup(setupInput, extensionResources);
    const workbench = createWorkbenchControlPlane({
      setup,
      persistence: createSharedProfilePersistenceAdapter(createMemoryPersistence()),
      idSource: {
        nextId: (kind) => `${kind}:composition`,
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'research-model',
      initializerId: 'import',
      input: { source: 'fixture://base' },
    });

    expect(result).toEqual({ runId: 'run:composition' });
    expect(initializeBackend).toHaveBeenCalledOnce();
    expect(verifyArtifact).toHaveBeenCalledOnce();
    await expect(
      workbench.runs.get({ profileId: 'research-model', runId: 'run:composition' })
    ).resolves.toMatchObject({
      status: 'succeeded',
      capabilityId: 'models.import',
      runtimeBindingId: 'runtime.fixture',
      result: { data: { importedFrom: 'fixture://base' } },
    });
    await expect(
      workbench.models.getBase({ profileId: 'research-model', baseId: 'base:composition' })
    ).resolves.toMatchObject({
      profileId: 'research-model',
      artifact: {
        artifactId: 'artifact:composition',
        handoff: {
          runtimeSupportId: 'artifacts.fixture',
          receipt: { location: 'fixture://initialized-parameters' },
        },
      },
      lineage: {
        capabilityId: 'models.import',
        runtimeBindingId: 'runtime.fixture',
      },
    });
  });
});
