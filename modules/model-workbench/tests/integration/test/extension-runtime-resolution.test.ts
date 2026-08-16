import { describe, expect, it, vi } from 'vitest';

import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  parseArtifactId,
  parseRunId,
} from '@ta-agent/workbench-domain';
import {
  CapabilityOutcomeStatus,
  defineArtifactVerifierSupport,
  defineExtensionValueContract,
  defineInitializerCapability,
  parseInitializationCapabilityOutcome,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@ta-agent/workbench-setup';

describe('Extension Runtime resolution', () => {
  it('resolves static selectors into typed process-local callable resources', async () => {
    const initialize = vi.fn((request: { readonly input: ImportInput }) =>
      Promise.resolve({
        status: CapabilityOutcomeStatus.Succeeded,
        artifact: {
          artifactId: request.input.targetArtifactId,
          digest: `sha256:${'d'.repeat(64)}`,
        },
        data: { source: request.input.source },
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
        defineArtifactVerifierSupport({
          runtimeSupportId: 'demo.artifact-verifier',
          verify,
        }),
      ],
    };
    const setupInput = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'demo.runtime',
          supports: { artifactVerifierId: 'demo.artifact-verifier' },
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
      runId: parseRunId('run:demo'),
      plannedArtifactId: parseArtifactId('artifact:demo'),
      input: { source: 'fixture://base', targetArtifactId: 'artifact:demo' },
    });
    const parsedOutcome = parseInitializationCapabilityOutcome(outcome);
    if (parsedOutcome.status !== CapabilityOutcomeStatus.Succeeded) {
      throw new Error('Expected a successful fixture outcome.');
    }
    const { artifact } = parsedOutcome;
    await slot.runtime.supports.artifactVerifier.verify({ artifact });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { source: 'fixture://base', targetArtifactId: 'artifact:demo' },
      }),
      undefined
    );
    expect(verify).toHaveBeenCalledWith({ artifact });
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
