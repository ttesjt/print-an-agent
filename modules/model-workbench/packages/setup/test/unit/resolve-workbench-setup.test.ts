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
  defineExporterCapability,
  defineInitializerCapability,
  defineJsonSchemaContract,
  defineOutputInvokerCapability,
  defineTrainerCapability,
  ExecutionStatus,
  ModelCapabilityKind,
  type TypedInitializerCapability,
} from '@print-an-agent/workbench-extension';

import {
  RuntimeBindingKind,
  WorkbenchSetupError,
  findProfileArtifactHandoffSupport,
  findResolvedCanonicalOutputInvoker,
  findResolvedExporter,
  findResolvedOutputInvoker,
  findResolvedTrainer,
  resolveWorkbenchSetup,
  type WorkbenchExtensionResources,
} from '../../src/index.js';

describe('resolveWorkbenchSetup', () => {
  it('binds separate callable Capability and Runtime Support resources into each slot', async () => {
    const initialize = vi.fn(() =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifact: {
              digest: `sha256:${'a'.repeat(64)}`,
              receipt: { location: 'fixture://artifact:1' },
            },
          },
        },
      })
    );
    const verify = vi.fn(() => Promise.resolve());
    const resources = extensionResources({ initialize, verify });

    const setup = resolveWorkbenchSetup(validSetup(), resources);
    const slot = setup.profiles[0]?.initializers[0];
    if (slot === undefined) throw new Error('Expected one resolved Initializer slot.');

    await slot.capability.initialize({
      operation: ModelOperationKind.Initialization,
      profileId: parseProfileId('profile:demo'),
      runId: parseRunId('run:1'),
      input: { source: 'fixture://base' },
    });
    await slot.runtime.supports.artifactHandoff.verify({
      profileId: parseProfileId('profile:demo'),
      artifact: parseArtifactReference({
        artifactId: 'artifact:1',
        digest: `sha256:${'a'.repeat(64)}`,
        handoff: {
          runtimeSupportId: 'artifacts.local',
          receipt: { location: 'fixture://artifact:1' },
        },
      }),
    });

    expect(initialize).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(slot).toMatchObject({
      initializerId: 'import',
      capability: { capabilityId: 'initializer.import' },
      runtime: {
        runtimeBindingId: 'runtime.local',
        supports: {
          artifactHandoff: { runtimeSupportId: 'artifacts.local' },
          execution: { runtimeSupportId: 'execution.local' },
        },
      },
    });
  });

  it('allows an Output Invoker binding to omit Execution Support', () => {
    const invocationBinding = {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'runtime.invocation',
      supports: { artifactHandoffId: 'artifacts.local' },
    } as const;
    const setup = resolveWorkbenchSetup(
      {
        runtimeBindings: [runtimeBinding('runtime.local'), invocationBinding],
        profiles: [
          {
            ...profile('research-model', 'import', 'initializer.import', 'runtime.local'),
            outputInvokers: [
              {
                outputInvokerId: 'generate',
                capabilityId: 'output-invoker.llama-cpp',
                runtimeBindingId: 'runtime.invocation',
              },
            ],
          },
        ],
      },
      {
        modelCapabilities: [initializerCapability(vi.fn()), outputInvokerCapability()],
        runtimeSupports: runtimeSupports(),
      }
    );

    const resolvedProfile = setup.profiles[0];
    if (resolvedProfile === undefined) throw new Error('Expected one resolved Profile.');
    const outputInvoker = findResolvedOutputInvoker(resolvedProfile, 'generate');
    expect(outputInvoker?.runtime.supports.artifactHandoff.runtimeSupportId).toBe(
      'artifacts.local'
    );
    expect(outputInvoker?.runtime.supports.execution).toBeUndefined();
    expect(findResolvedCanonicalOutputInvoker(resolvedProfile)).toBe(outputInvoker);
  });

  it('resolves an explicitly configured canonical Output Invoker', () => {
    const setup = resolveOutputInvokerSetup(['fast', 'quality'], 'quality');

    const resolvedProfile = setup.profiles[0];
    if (resolvedProfile === undefined) throw new Error('Expected one resolved Profile.');
    expect(findResolvedCanonicalOutputInvoker(resolvedProfile)?.outputInvokerId).toBe('quality');
  });

  it('keeps a Profile with ambiguous Output Invokers valid without selecting one', () => {
    const setup = resolveOutputInvokerSetup(['first', 'second']);

    const resolvedProfile = setup.profiles[0];
    if (resolvedProfile === undefined) throw new Error('Expected one resolved Profile.');
    expect(resolvedProfile.outputInvokers).toHaveLength(2);
    expect(findResolvedCanonicalOutputInvoker(resolvedProfile)).toBeUndefined();
  });

  it('rejects a canonical Output Invoker ID that is not declared by its Profile', () => {
    expect(() => resolveOutputInvokerSetup(['generate'], 'missing')).toThrow(
      'setup.profiles[0].canonicalOutputInvokerId references unknown Output Invoker'
    );
  });

  it('derives Profile evidence from the effective canonical Output Invoker selection', () => {
    const first = resolveOutputInvokerSetup(['first', 'second'], 'first');
    const second = resolveOutputInvokerSetup(['first', 'second'], 'second');
    const implicitSoleInvoker = resolveOutputInvokerSetup(['only']);
    const explicitSoleInvoker = resolveOutputInvokerSetup(['only'], 'only');

    expect(second.profiles[0]?.evidenceDigest).not.toBe(first.profiles[0]?.evidenceDigest);
    expect(explicitSoleInvoker.profiles[0]?.evidenceDigest).toBe(
      implicitSoleInvoker.profiles[0]?.evidenceDigest
    );
  });

  it('uses Draft 2020-12 contracts to validate input and result data', async () => {
    const initialize = vi.fn((request: { readonly input: ImportInput }) =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifact: {
              digest: `sha256:${'b'.repeat(64)}`,
              receipt: { location: 'fixture://artifact:1' },
            },
            data: { imported: request.input.source },
          },
        },
      })
    );
    const capability = initializerCapability(initialize);

    await expect(
      capability.initialize({
        operation: ModelOperationKind.Initialization,
        profileId: parseProfileId('profile:demo'),
        runId: parseRunId('run:1'),
        input: { source: 42 },
      })
    ).rejects.toThrow(InvalidWorkbenchValueError);
    expect(initialize).not.toHaveBeenCalled();

    await expect(
      capability.initialize({
        operation: ModelOperationKind.Initialization,
        profileId: parseProfileId('profile:demo'),
        runId: parseRunId('run:1'),
        input: { source: 'fixture://base' },
      })
    ).resolves.toMatchObject({
      terminal: { result: { data: { imported: 'fixture://base' } } },
    });

    const invalidResultCapability = initializerCapability((() =>
      Promise.resolve({
        kind: CapabilityDispatchKind.Completed,
        terminal: {
          status: ExecutionStatus.Succeeded,
          result: {
            artifact: {
              digest: `sha256:${'b'.repeat(64)}`,
              receipt: { location: 'fixture://artifact:1' },
            },
            data: { imported: 42 },
          },
        },
      })) as unknown as TypedInitializerCapability<ImportInput, ImportResultData>);
    await expect(
      invalidResultCapability.initialize({
        operation: ModelOperationKind.Initialization,
        profileId: parseProfileId('profile:demo'),
        runId: parseRunId('run:1'),
        input: { source: 'fixture://base' },
      })
    ).rejects.toThrow(InvalidWorkbenchValueError);
  });

  it('resolves Trainer slots and Profile-scoped Artifact Supports', () => {
    const baseInput = validSetup();
    const input = {
      ...baseInput,
      profiles: [
        {
          ...baseInput.profiles[0]!,
          trainers: [
            {
              trainerId: 'lora',
              capabilityId: 'trainer.lora',
              runtimeBindingId: 'runtime.local',
            },
          ],
        },
      ],
    };
    const resources: WorkbenchExtensionResources = {
      modelCapabilities: [initializerCapability(vi.fn()), trainerCapability()],
      runtimeSupports: runtimeSupports(),
    };

    const setup = resolveWorkbenchSetup(input, resources);
    const profile = setup.profiles[0];
    if (profile === undefined) throw new Error('Expected one resolved Profile.');

    expect(findResolvedTrainer(profile, 'lora')).toMatchObject({
      trainerId: 'lora',
      capability: { capabilityId: 'trainer.lora', kind: ModelCapabilityKind.Trainer },
      runtime: { runtimeBindingId: 'runtime.local' },
    });
    expect(findProfileArtifactHandoffSupport(profile, 'artifacts.local')).toBe(
      profile.trainers[0]?.runtime.supports.artifactHandoff
    );
  });

  it('resolves Exporter and Output Invoker slots as separate capability bindings', () => {
    const baseInput = validSetup();
    const input = {
      ...baseInput,
      profiles: [
        {
          ...baseInput.profiles[0]!,
          exporters: [
            {
              exporterId: 'gguf',
              capabilityId: 'exporter.gguf',
              runtimeBindingId: 'runtime.local',
            },
          ],
          outputInvokers: [
            {
              outputInvokerId: 'llama-cpp',
              capabilityId: 'output-invoker.llama-cpp',
              runtimeBindingId: 'runtime.local',
            },
          ],
        },
      ],
    };
    const resources: WorkbenchExtensionResources = {
      modelCapabilities: [
        initializerCapability(vi.fn()),
        exporterCapability(),
        outputInvokerCapability(),
      ],
      runtimeSupports: runtimeSupports(),
    };

    const setup = resolveWorkbenchSetup(input, resources);
    const profile = setup.profiles[0];
    if (profile === undefined) throw new Error('Expected one resolved Profile.');

    expect(findResolvedExporter(profile, 'gguf')).toMatchObject({
      exporterId: 'gguf',
      capability: { capabilityId: 'exporter.gguf', kind: ModelCapabilityKind.Exporter },
      runtime: { runtimeBindingId: 'runtime.local' },
    });
    expect(findResolvedOutputInvoker(profile, 'llama-cpp')).toMatchObject({
      outputInvokerId: 'llama-cpp',
      capability: {
        capabilityId: 'output-invoker.llama-cpp',
        kind: ModelCapabilityKind.OutputInvoker,
      },
      runtime: { runtimeBindingId: 'runtime.local' },
    });
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
        runtimeSupports: runtimeSupports(),
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
        runtimeSupports: [...runtimeSupports()].reverse(),
      }
    );
    const changedContract = resolveWorkbenchSetup(validSetup(), {
      modelCapabilities: [initializerCapability(vi.fn(), 'initializer.import', 2)],
      runtimeSupports: runtimeSupports(),
    });

    expect(second.evidenceDigest).toBe(first.evidenceDigest);
    expect(changedContract.evidenceDigest).not.toBe(
      resolveWorkbenchSetup(validSetup(), extensionResources()).evidenceDigest
    );
  });

  it('keeps optional Profile infrastructure routing configuration outside Profile evidence', () => {
    const firstBase = validSetup();
    const firstInput = {
      ...firstBase,
      profiles: firstBase.profiles.map((profile) => ({
        ...profile,
        infrastructure: {
          persistence: { configuration: { database: 'profile-a.sqlite' } },
        },
      })),
    };
    const secondBase = validSetup();
    const secondInput = {
      ...secondBase,
      profiles: secondBase.profiles.map((profile) => ({
        ...profile,
        infrastructure: {
          persistence: { configuration: { database: 'profile-b.sqlite' } },
        },
      })),
    };

    const first = resolveWorkbenchSetup(firstInput, extensionResources());
    const second = resolveWorkbenchSetup(secondInput, extensionResources());

    expect(first.profiles[0]?.infrastructure.persistence.configuration).toEqual({
      database: 'profile-a.sqlite',
    });
    expect(second.evidenceDigest).toBe(first.evidenceDigest);
  });

  it('rejects non-object Profile persistence configuration', () => {
    const base = validSetup();
    const input = {
      ...base,
      profiles: base.profiles.map((profile) => ({
        ...profile,
        infrastructure: { persistence: { configuration: ['not', 'an', 'object'] } },
      })),
    };

    expect(() => resolveWorkbenchSetup(input, extensionResources())).toThrow(
      'setup.profiles[0].infrastructure.persistence.configuration'
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
        input.runtimeBindings[0]!.supports.artifactHandoffId = 'missing';
      },
      path: 'setup.runtimeBindings[0].supports.artifactHandoffId',
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
      runtimeSupports: runtimeSupports(),
    };

    expect(() => resolveWorkbenchSetup(validSetup(), duplicateResources)).toThrow(
      WorkbenchSetupError
    );
    expect(() =>
      resolveWorkbenchSetup({ ...validSetup(), currentVersion: 1 }, extensionResources())
    ).toThrow('setup.currentVersion');
  });

  it('rejects a Trainer slot bound to an Initializer Capability', () => {
    const baseInput = validSetup();
    const input = {
      ...baseInput,
      profiles: [
        {
          ...baseInput.profiles[0]!,
          trainers: [
            {
              trainerId: 'invalid',
              capabilityId: 'initializer.import',
              runtimeBindingId: 'runtime.local',
            },
          ],
        },
      ],
    };

    expect(() => resolveWorkbenchSetup(input, extensionResources())).toThrow(
      'must reference Model Capability kind "trainer"'
    );
  });
});

interface ImportInput {
  readonly source: string;
}

interface ImportResultData {
  readonly imported: string;
}

function initializerCapability(
  initialize: TypedInitializerCapability<ImportInput, ImportResultData>,
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

function trainerCapability() {
  return defineTrainerCapability({
    capabilityId: 'trainer.lora',
    input: defineJsonSchemaContract({
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: true,
      } as const,
    }),
    train: vi.fn(),
  });
}

function exporterCapability() {
  return defineExporterCapability({
    capabilityId: 'exporter.gguf',
    input: jsonObjectContract(),
    export: vi.fn(),
  });
}

function outputInvokerCapability(capabilityId = 'output-invoker.llama-cpp') {
  return defineOutputInvokerCapability({
    capabilityId,
    input: jsonObjectContract(),
    output: jsonObjectContract(),
    invoke: vi.fn(),
  });
}

function jsonObjectContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: true,
    } as const,
  });
}

function artifactHandoff(runtimeSupportId: string, verify: () => Promise<void>) {
  return defineArtifactHandoffSupport({
    runtimeSupportId,
    verify,
    materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
  });
}

function runtimeSupports(verify: () => Promise<void> = () => Promise.resolve()) {
  return [
    artifactHandoff('artifacts.local', verify),
    defineExecutionSupport({
      runtimeSupportId: 'execution.local',
      observe: vi.fn(),
      cancel: vi.fn(),
    }),
  ];
}

function extensionResources(overrides?: {
  readonly initialize?: TypedInitializerCapability<ImportInput, ImportResultData>;
  readonly verify?: () => Promise<void>;
}): WorkbenchExtensionResources {
  return {
    modelCapabilities: [initializerCapability(overrides?.initialize ?? vi.fn())],
    runtimeSupports: runtimeSupports(overrides?.verify),
  };
}

function runtimeBinding(runtimeBindingId: string) {
  return {
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: {
      artifactHandoffId: 'artifacts.local',
      executionSupportId: 'execution.local',
    },
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

function resolveOutputInvokerSetup(
  outputInvokerIds: readonly string[],
  canonicalOutputInvokerId?: string
) {
  const baseInput = validSetup();
  return resolveWorkbenchSetup(
    {
      ...baseInput,
      profiles: [
        {
          ...baseInput.profiles[0]!,
          ...(canonicalOutputInvokerId === undefined ? {} : { canonicalOutputInvokerId }),
          outputInvokers: outputInvokerIds.map((outputInvokerId) => ({
            outputInvokerId,
            capabilityId: `output-invoker.${outputInvokerId}`,
            runtimeBindingId: 'runtime.local',
          })),
        },
      ],
    },
    {
      modelCapabilities: [
        initializerCapability(vi.fn()),
        ...outputInvokerIds.map((outputInvokerId) =>
          outputInvokerCapability(`output-invoker.${outputInvokerId}`)
        ),
      ],
      runtimeSupports: runtimeSupports(),
    }
  );
}
