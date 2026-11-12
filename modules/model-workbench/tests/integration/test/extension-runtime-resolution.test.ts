import { describe, expect, it, vi } from 'vitest';

import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  parseArtifactReference,
  parseProfileId,
  parseRunId,
} from '@print-an-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExtensionValueContract,
  defineInitializerCapability,
  ExecutionStatus,
} from '@print-an-agent/workbench-extension';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@print-an-agent/workbench-setup';

describe('Extension Runtime resolution', () => {
  it('resolves static selectors into typed process-local callable resources', async () => {
    const initialize = vi.fn((request: { readonly input: ImportInput }) =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifact: {
              digest: `sha256:${'d'.repeat(64)}`,
              receipt: { location: `fixture://${request.input.targetArtifactId}` },
            },
            data: { source: request.input.source },
          },
        },
      })
    );
    const verify = vi.fn(() => Promise.resolve());

    const extensionResources = {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'demo.initializer',
          input: defineExtensionValueContract<ImportInput>({
            evidence: { contract: 'fixture-custom-parser', rules: importInputSchema },
            parse: parseImportInput,
          }),
          initialize,
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'demo.artifact-handoff',
          verify,
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'demo.execution',
          observe: vi.fn(),
          cancel: vi.fn(),
        }),
      ],
    };
    const setupInput = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'demo.runtime',
          supports: {
            artifactHandoffId: 'demo.artifact-handoff',
            executionSupportId: 'demo.execution',
          },
        },
      ],
      profiles: [
        {
          profileId: 'demo-profile',
          initializers: [
            {
              initializerId: 'default',
              capabilityId: 'demo.initializer',
              runtimeBindingId: 'demo.runtime',
            },
          ],
        },
      ],
    };

    const setup = resolveWorkbenchSetup(setupInput, extensionResources);
    const slot = setup.profiles[0]?.initializers[0];
    if (slot === undefined) throw new Error('Expected one resolved Initializer slot.');

    const outcome = await slot.capability.initialize({
      operation: ModelOperationKind.Initialization,
      profileId: parseProfileId('demo-profile'),
      runId: parseRunId('run:demo'),
      input: { source: 'fixture://base', targetArtifactId: 'artifact:demo' },
    });
    if (
      outcome.kind !== CapabilityDispatchKind.Completed ||
      outcome.terminal.status !== ExecutionStatus.Succeeded
    ) {
      throw new Error('Expected a successful fixture outcome.');
    }
    const { artifact } = outcome.terminal.result;
    const reference = parseArtifactReference({
      artifactId: 'artifact:demo',
      digest: artifact.digest,
      handoff: {
        runtimeSupportId: slot.runtime.supports.artifactHandoff.runtimeSupportId,
        receipt: artifact.receipt,
      },
    });
    await slot.runtime.supports.artifactHandoff.verify({
      profileId: parseProfileId('demo-profile'),
      artifact: reference,
    });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { source: 'fixture://base', targetArtifactId: 'artifact:demo' },
      }),
      undefined
    );
    expect(verify).toHaveBeenCalledWith(
      { profileId: 'demo-profile', artifact: reference },
      undefined
    );
    expect(slot.capability.contracts.input.evidence).toEqual({
      contract: 'fixture-custom-parser',
      rules: importInputSchema,
    });
  });
});

interface ImportInput {
  readonly source: string;
  readonly targetArtifactId: string;
}

const importInputSchema = Object.freeze({
  type: 'object',
  required: Object.freeze(['source', 'targetArtifactId']),
  properties: Object.freeze({
    source: Object.freeze({ type: 'string' }),
    targetArtifactId: Object.freeze({ type: 'string' }),
  }),
  additionalProperties: false,
});

function parseImportInput(input: unknown, path: string): ImportInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be an object');
  }
  const record = input as Readonly<Record<string, unknown>>;
  if (typeof record.source !== 'string') {
    throw new InvalidWorkbenchValueError(`${path}.source`, 'must be a string');
  }
  if (typeof record.targetArtifactId !== 'string') {
    throw new InvalidWorkbenchValueError(`${path}.targetArtifactId`, 'must be a string');
  }
  return Object.freeze({ source: record.source, targetArtifactId: record.targetArtifactId });
}
