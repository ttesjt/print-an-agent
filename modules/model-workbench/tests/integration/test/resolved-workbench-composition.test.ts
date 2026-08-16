import { describe, expect, it, vi } from 'vitest';

import { createWorkbenchControlPlane } from '@ta-agent/workbench-control-plane';
import { parseBaseId, parseRunId, type ArtifactReference } from '@ta-agent/workbench-domain';
import {
  CapabilityOutcomeStatus,
  JsonSchemaDialect,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
  defineJsonSchemaContract,
} from '@ta-agent/workbench-extension';
import { createMemoryPersistence } from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@ta-agent/workbench-setup';

describe('resolved Workbench composition', () => {
  it('runs one governed Capability plus Runtime Support operation through both layers', async () => {
    const initializeBackend = vi.fn(
      (request: {
        readonly input: { readonly source: string };
        readonly plannedArtifactId: string;
      }) =>
        Promise.resolve({
          status: CapabilityOutcomeStatus.Succeeded,
          artifact: {
            artifactId: request.plannedArtifactId,
            digest: `sha256:${'c'.repeat(64)}`,
          },
          data: { importedFrom: request.input.source },
        })
    );
    const verifyArtifact = vi.fn(({ artifact }: { readonly artifact: ArtifactReference }) => {
      expect(artifact.digest).toBe(`sha256:${'c'.repeat(64)}`);
      return Promise.resolve();
    });
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
        defineArtifactVerifierSupport({
          runtimeSupportId: 'artifacts.fixture',
          verify: verifyArtifact,
        }),
      ],
    };
    const setupInput = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.fixture',
          supports: { artifactVerifierId: 'artifacts.fixture' },
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
      persistence: createMemoryPersistence(),
      idSource: {
        nextId: (kind) => `${kind}:composition`,
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'research-model',
      initializerId: 'import',
      input: { source: 'fixture://base' },
    });

    expect(result).toEqual({
      status: CapabilityOutcomeStatus.Succeeded,
      runId: 'run:composition',
      baseId: 'base:composition',
    });
    expect(initializeBackend).toHaveBeenCalledOnce();
    expect(verifyArtifact).toHaveBeenCalledOnce();
    await expect(workbench.runs.get(parseRunId('run:composition'))).resolves.toMatchObject({
      status: 'succeeded',
      capabilityId: 'models.import',
      runtimeBindingId: 'runtime.fixture',
      result: { data: { importedFrom: 'fixture://base' } },
    });
    await expect(workbench.models.getBase(parseBaseId('base:composition'))).resolves.toMatchObject({
      profileId: 'research-model',
      artifact: { artifactId: 'artifact:composition' },
      lineage: {
        capabilityId: 'models.import',
        runtimeBindingId: 'runtime.fixture',
      },
    });
  });
});
