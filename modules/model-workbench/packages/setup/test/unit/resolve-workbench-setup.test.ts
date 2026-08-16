import { describe, expect, it, vi } from 'vitest';

import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  parseArtifactId,
  parseRunId,
  parseSha256Digest,
} from '@ta-agent/workbench-domain';
import {
  CapabilityOutcomeStatus,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
  defineJsonSchemaContract,
} from '@ta-agent/workbench-extension';

import {
  RuntimeBindingKind,
  WorkbenchSetupError,
  resolveWorkbenchSetup,
  type WorkbenchExtensionResources,
} from '../../src/index.js';

describe('resolveWorkbenchSetup', () => {
  it('binds separate callable Capability and Runtime Support resources into each slot', async () => {
    const initialize = vi.fn(() =>
      Promise.resolve({
        status: CapabilityOutcomeStatus.Succeeded,
        artifact: { artifactId: 'artifact:1', digest: `sha256:${'a'.repeat(64)}` },
      })
    );
    const verify = vi.fn(() => Promise.resolve());
    const resources = extensionResources({ initialize, verify });

    const setup = resolveWorkbenchSetup(validSetup(), resources);
    const slot = setup.profiles[0]?.initializers[0];
    if (slot === undefined) throw new Error('Expected one resolved Initializer slot.');

    await slot.capability.initialize({
      operation: ModelOperationKind.Initialization,
      runId: parseRunId('run:1'),
      plannedArtifactId: parseArtifactId('artifact:1'),
      input: { source: 'fixture://base' },
    });
    await slot.runtime.supports.artifactVerifier.verify({
      artifact: {
        artifactId: parseArtifactId('artifact:1'),
        digest: parseSha256Digest(`sha256:${'a'.repeat(64)}`),
      },
    });

    expect(initialize).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(slot).toMatchObject({
      initializerId: 'import',
      capability: { capabilityId: 'initializer.import' },
      runtime: {
        runtimeBindingId: 'runtime.local',
        supports: { artifactVerifier: { runtimeSupportId: 'artifacts.local' } },
      },
    });
  });

  it('uses Draft 2020-12 contracts to validate input and result data', async () => {
    const initialize = vi.fn((request: { readonly input: ImportInput }) =>
      Promise.resolve({
        status: CapabilityOutcomeStatus.Succeeded,
        artifact: { artifactId: 'artifact:1', digest: `sha256:${'b'.repeat(64)}` },
        data: { imported: request.input.source },
      })
    );
    const capability = initializerCapability(initialize);

    await expect(
      capability.initialize({
        operation: ModelOperationKind.Initialization,
        runId: parseRunId('run:1'),
        plannedArtifactId: parseArtifactId('artifact:1'),
        input: { source: 42 },
      })
    ).rejects.toThrow(InvalidWorkbenchValueError);
    expect(initialize).not.toHaveBeenCalled();

    await expect(
      capability.initialize({
        operation: ModelOperationKind.Initialization,
        runId: parseRunId('run:1'),
        plannedArtifactId: parseArtifactId('artifact:1'),
        input: { source: 'fixture://base' },
      })
    ).resolves.toMatchObject({ data: { imported: 'fixture://base' } });

    const invalidResultCapability = initializerCapability(() =>
      Promise.resolve({
        status: CapabilityOutcomeStatus.Succeeded,
        artifact: { artifactId: 'artifact:1', digest: `sha256:${'b'.repeat(64)}` },
        data: { imported: 42 },
      })
    );
    await expect(
      invalidResultCapability.initialize({
        operation: ModelOperationKind.Initialization,
        runId: parseRunId('run:1'),
        plannedArtifactId: parseArtifactId('artifact:1'),
        input: { source: 'fixture://base' },
      })
    ).rejects.toThrow(InvalidWorkbenchValueError);
  });

  it('derives evidence from contracts, never function identity or declaration order', () => {
    const first = resolveWorkbenchSetup(
      {
        runtimeBindings: [runtimeBinding('runtime.z'), runtimeBinding('runtime.a')],
        profiles: [
          profile('profile.z', 'z', 'capability.z', 'runtime.z'),
          profile('profile.a', 'a', 'capability.a', 'runtime.a'),
        ],
      },
      {
        modelCapabilities: [
          initializerCapability(vi.fn(), 'capability.z'),
          initializerCapability(vi.fn(), 'capability.a'),
        ],
        runtimeSupports: [artifactVerifier('artifacts.local', vi.fn())],
      }
    );
    const second = resolveWorkbenchSetup(
      {
        runtimeBindings: [runtimeBinding('runtime.a'), runtimeBinding('runtime.z')],
        profiles: [...first.profiles].reverse().map((resolvedProfile) => ({
          profileId: resolvedProfile.profileId,
          initializers: resolvedProfile.initializers.map((initializer) => ({
            initializerId: initializer.initializerId,
            capabilityId: initializer.capability.capabilityId,
            runtimeBindingId: initializer.runtime.runtimeBindingId,
          })),
        })),
      },
      {
        modelCapabilities: [
          initializerCapability(vi.fn(), 'capability.a'),
          initializerCapability(vi.fn(), 'capability.z'),
        ],
        runtimeSupports: [artifactVerifier('artifacts.local', vi.fn())],
      }
    );
    const changedContract = resolveWorkbenchSetup(validSetup(), {
      modelCapabilities: [initializerCapability(vi.fn(), 'initializer.import', 2)],
      runtimeSupports: [artifactVerifier('artifacts.local', vi.fn())],
    });

    expect(second.evidenceDigest).toBe(first.evidenceDigest);
    expect(changedContract.evidenceDigest).not.toBe(
      resolveWorkbenchSetup(validSetup(), extensionResources()).evidenceDigest
    );
  });

  it.each([
    {
      name: 'unknown Capability',
      mutate: (input: ReturnType<typeof validSetup>) => {
        input.profiles[0]!.initializers[0]!.capabilityId = 'missing';
      },
      path: 'setup.profiles[0].initializers[0].capabilityId',
    },
    {
      name: 'unknown Runtime Binding',
      mutate: (input: ReturnType<typeof validSetup>) => {
        input.profiles[0]!.initializers[0]!.runtimeBindingId = 'missing';
      },
      path: 'setup.profiles[0].initializers[0].runtimeBindingId',
    },
    {
      name: 'unknown Runtime Support',
      mutate: (input: ReturnType<typeof validSetup>) => {
        input.runtimeBindings[0]!.supports.artifactVerifierId = 'missing';
      },
      path: 'setup.runtimeBindings[0].supports.artifactVerifierId',
    },
  ])('rejects an $name reference', ({ mutate, path }) => {
    const input = validSetup();
    mutate(input);

    expect(() => resolveWorkbenchSetup(input, extensionResources())).toThrow(path);
  });

  it('rejects duplicate resources and unknown static fields', () => {
    const capability = initializerCapability(vi.fn());
    const duplicateResources: WorkbenchExtensionResources = {
      modelCapabilities: [capability, capability],
      runtimeSupports: [artifactVerifier('artifacts.local', vi.fn())],
    };

    expect(() => resolveWorkbenchSetup(validSetup(), duplicateResources)).toThrow(
      WorkbenchSetupError
    );
    expect(() =>
      resolveWorkbenchSetup({ ...validSetup(), currentVersion: 1 }, extensionResources())
    ).toThrow('setup.currentVersion');
  });
});

interface ImportInput {
  readonly source: string;
}

function initializerCapability(
  initialize: (request: { readonly input: ImportInput }) => Promise<unknown>,
  capabilityId = 'initializer.import',
  minimumSourceLength?: number
) {
  const input = defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['source'],
      properties: {
        source: {
          type: 'string',
          ...(minimumSourceLength === undefined ? {} : { minLength: minimumSourceLength }),
        },
      },
      additionalProperties: false,
    } as const,
  });
  const resultData = defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['imported'],
      properties: { imported: { type: 'string' } },
      additionalProperties: false,
    } as const,
  });
  return defineInitializerCapability({
    capabilityId,
    input,
    resultData,
    initialize,
  });
}

function artifactVerifier(runtimeSupportId: string, verify: () => Promise<void>) {
  return defineArtifactVerifierSupport({ runtimeSupportId, verify });
}

function extensionResources(overrides?: {
  readonly initialize?: (request: { readonly input: ImportInput }) => Promise<unknown>;
  readonly verify?: () => Promise<void>;
}): WorkbenchExtensionResources {
  return {
    modelCapabilities: [initializerCapability(overrides?.initialize ?? vi.fn())],
    runtimeSupports: [artifactVerifier('artifacts.local', overrides?.verify ?? vi.fn())],
  };
}

function runtimeBinding(runtimeBindingId: string) {
  return {
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: { artifactVerifierId: 'artifacts.local' },
  };
}

function profile(
  profileId: string,
  initializerId: string,
  capabilityId: string,
  runtimeBindingId: string
) {
  return {
    profileId,
    initializers: [{ initializerId, capabilityId, runtimeBindingId }],
  };
}

function validSetup() {
  return {
    runtimeBindings: [runtimeBinding('runtime.local')],
    profiles: [profile('research-model', 'import', 'initializer.import', 'runtime.local')],
  };
}
