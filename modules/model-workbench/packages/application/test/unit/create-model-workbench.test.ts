import { describe, expect, it } from 'vitest';

import {
  CapabilityDispatchKind,
  JsonValueContract,
  OutputInvocationKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExporterCapability,
  defineInitializerCapability,
  defineOutputInvokerCapability,
  defineTrainerCapability,
  ExecutionStatus,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';
import {
  createMemoryPersistence,
  type ProfilePersistence,
  type ProfilePersistenceAdapter,
  type ProfilePersistenceScope,
} from '@ta-agent/workbench-persistence';

import { createModelWorkbench } from '../../src/index.js';

type BaseIdentity = Parameters<ProfilePersistence['parameters']['findBase']>[0];
type ModificationIdentity = Parameters<ProfilePersistence['parameters']['findModification']>[0];
type OutputIdentity = Parameters<ProfilePersistence['outputs']['findOutput']>[0];

describe('createModelWorkbench', () => {
  it('resolves setup and runs Initialization through Training and Export', async () => {
    const generated = {
      run: ['run:initialization', 'run:training', 'run:export'],
      base: ['base:source'],
      modification: ['modification:trained'],
      output: ['output:exported'],
      artifact: ['artifact:source', 'artifact:trained', 'artifact:exported'],
    } as const;
    const generatedIndex = { run: 0, base: 0, modification: 0, output: 0, artifact: 0 };
    const stored = createMemoryPersistence();
    const findBase = misrouteAfterKnownRecord(
      (baseId: BaseIdentity) => stored.parameters.findBase(baseId),
      'base:misrouted-request'
    );
    const findModification = misrouteAfterKnownRecord(
      (modificationId: ModificationIdentity) => stored.parameters.findModification(modificationId),
      'modification:misrouted-request'
    );
    const findOutput = misrouteAfterKnownRecord(
      (outputId: OutputIdentity) => stored.outputs.findOutput(outputId),
      'output:misrouted-request'
    );
    const persistence: ProfilePersistence = Object.freeze({
      ...stored,
      parameters: Object.freeze({
        ...stored.parameters,
        findBase,
        findModification,
      }),
      outputs: Object.freeze({
        ...stored.outputs,
        findOutput,
      }),
    });
    const workbench = createModelWorkbench({
      setup: {
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
            profileId: 'fixture-profile',
            initializers: [
              {
                initializerId: 'default',
                capabilityId: 'initializer.fixture',
                runtimeBindingId: 'runtime.fixture',
              },
            ],
            trainers: [
              {
                trainerId: 'default',
                capabilityId: 'trainer.fixture',
                runtimeBindingId: 'runtime.fixture',
              },
            ],
            exporters: [
              {
                exporterId: 'default',
                capabilityId: 'exporter.fixture',
                runtimeBindingId: 'runtime.fixture',
              },
            ],
            outputInvokers: [
              {
                outputInvokerId: 'default',
                capabilityId: 'output-invoker.fixture',
                runtimeBindingId: 'runtime.fixture',
              },
            ],
          },
        ],
      },
      extensions: {
        modelCapabilities: [
          defineInitializerCapability({
            capabilityId: 'initializer.fixture',
            input: JsonValueContract,
            initialize: () =>
              Promise.resolve({
                kind: CapabilityDispatchKind.Completed,
                terminal: {
                  status: ExecutionStatus.Succeeded,
                  result: {
                    artifact: {
                      digest: `sha256:${'a'.repeat(64)}`,
                      receipt: { location: 'fixture://initialized' },
                    },
                  },
                },
              }),
          }),
          defineTrainerCapability({
            capabilityId: 'trainer.fixture',
            input: JsonValueContract,
            train: () =>
              Promise.resolve({
                kind: CapabilityDispatchKind.Completed,
                terminal: {
                  status: ExecutionStatus.Succeeded,
                  result: {
                    assetKind: 'modification',
                    artifact: {
                      digest: `sha256:${'b'.repeat(64)}`,
                      receipt: { location: 'fixture://trained' },
                    },
                  },
                },
              }),
          }),
          defineExporterCapability({
            capabilityId: 'exporter.fixture',
            input: JsonValueContract,
            export: () =>
              Promise.resolve({
                kind: CapabilityDispatchKind.Completed,
                terminal: {
                  status: ExecutionStatus.Succeeded,
                  result: {
                    artifacts: [
                      {
                        name: 'model',
                        artifact: {
                          digest: `sha256:${'c'.repeat(64)}`,
                          receipt: { location: 'fixture://exported' },
                        },
                      },
                    ],
                  },
                },
              }),
          }),
          defineOutputInvokerCapability({
            capabilityId: 'output-invoker.fixture',
            input: JsonValueContract,
            output: JsonValueContract,
            invoke: ({ target, input }) => {
              const model = target.artifacts[0];
              if (model === undefined) {
                throw new Error('Fixture Output must contain a model Artifact.');
              }
              return Promise.resolve({
                kind: OutputInvocationKind.Completed,
                result: {
                  input,
                  outputId: target.output.outputId,
                  model: {
                    artifactId: model.artifact.artifactId,
                    digest: model.artifact.digest,
                    binding: model.artifact.binding,
                  },
                },
              });
            },
          }),
        ],
        runtimeSupports: [
          defineArtifactHandoffSupport({
            runtimeSupportId: 'artifacts.fixture',
            verify: () => Promise.resolve(),
            materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
          }),
          defineExecutionSupport({
            runtimeSupportId: 'execution.fixture',
            observe: () => Promise.reject(new Error('No detached execution is expected.')),
            cancel: () => Promise.resolve(),
          }),
        ],
      },
      persistence: Object.freeze({ forProfile: () => Promise.resolve(persistence) }),
      idSource: {
        nextId: (kind) => {
          const index = generatedIndex[kind];
          const identity = generated[kind][index];
          if (identity === undefined) throw new Error(`No generated ${kind} identity remains.`);
          generatedIndex[kind] = index + 1;
          return identity;
        },
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'fixture-profile',
      initializerId: 'default',
      input: null,
    });

    expect(result).toEqual({ runId: 'run:initialization' });
    await expect(
      workbench.models.getBase({ profileId: 'fixture-profile', baseId: 'base:source' })
    ).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: {
        artifactId: 'artifact:source',
        handoff: {
          runtimeSupportId: 'artifacts.fixture',
          receipt: { location: 'fixture://initialized' },
        },
      },
    });

    await expect(
      workbench.training.start({
        profileId: 'fixture-profile',
        trainerId: 'default',
        source: { baseId: 'base:source' },
        input: { steps: 1 },
      })
    ).resolves.toEqual({ runId: 'run:training' });
    await expect(
      workbench.models.getModification({
        profileId: 'fixture-profile',
        modificationId: 'modification:trained',
      })
    ).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: { artifactId: 'artifact:trained' },
      lineage: {
        kind: 'training',
        runId: 'run:training',
        source: { baseId: 'base:source', modificationIds: [] },
      },
    });

    await expect(
      workbench.exports.start({
        profileId: 'fixture-profile',
        exporterId: 'default',
        source: {
          baseId: 'base:source',
          modificationIds: ['modification:trained'],
        },
        input: { format: 'fixture' },
      })
    ).resolves.toEqual({ runId: 'run:export' });
    await expect(
      workbench.outputs.get({ profileId: 'fixture-profile', outputId: 'output:exported' })
    ).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifacts: [{ name: 'model', artifact: { artifactId: 'artifact:exported' } }],
      lineage: {
        kind: 'export',
        source: {
          baseId: 'base:source',
          modificationIds: ['modification:trained'],
        },
      },
    });

    await expect(
      workbench.outputInvocations.resolve({
        profileId: 'fixture-profile',
        outputId: 'output:exported',
      })
    ).resolves.toMatchObject({
      profileId: 'fixture-profile',
      outputId: 'output:exported',
      outputInvokerId: 'default',
    });

    await expect(
      workbench.outputInvocations.invoke({
        profileId: 'fixture-profile',
        outputId: 'output:exported',
        input: { prompt: 'fixture prompt' },
      })
    ).resolves.toMatchObject({
      kind: OutputInvocationKind.Completed,
      evidence: {
        profileId: 'fixture-profile',
        outputId: 'output:exported',
        outputInvokerId: 'default',
      },
      result: {
        input: { prompt: 'fixture prompt' },
        outputId: 'output:exported',
        model: { binding: { location: 'fixture://exported' } },
      },
    });

    await expect(
      workbench.models.getBase({
        profileId: 'fixture-profile',
        baseId: 'base:misrouted-request',
      })
    ).resolves.toBeUndefined();
    await expect(
      workbench.models.getModification({
        profileId: 'fixture-profile',
        modificationId: 'modification:misrouted-request',
      })
    ).resolves.toBeUndefined();
    await expect(
      workbench.outputs.get({
        profileId: 'fixture-profile',
        outputId: 'output:misrouted-request',
      })
    ).resolves.toBeUndefined();
  });

  it('routes isolated persistence and static configuration by Profile', async () => {
    const scopes: ProfilePersistenceScope[] = [];
    const persistenceByProfile = new Map<string, ProfilePersistence>();
    const persistence: ProfilePersistenceAdapter = Object.freeze({
      forProfile: (scope: ProfilePersistenceScope) => {
        scopes.push(scope);
        let resolved = persistenceByProfile.get(scope.profileId);
        if (resolved === undefined) {
          resolved = createMemoryPersistence();
          persistenceByProfile.set(scope.profileId, resolved);
        }
        return Promise.resolve(resolved);
      },
    });
    const workbench = createModelWorkbench({
      setup: {
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
        profiles: ['profile-a', 'profile-b'].map((profileId) => ({
          profileId,
          infrastructure: {
            persistence: { configuration: { database: `${profileId}.sqlite` } },
          },
          initializers: [
            {
              initializerId: 'default',
              capabilityId: 'initializer.fixture',
              runtimeBindingId: 'runtime.fixture',
            },
          ],
        })),
      },
      extensions: {
        modelCapabilities: [
          defineInitializerCapability({
            capabilityId: 'initializer.fixture',
            input: JsonValueContract,
            initialize: ({ profileId }) =>
              Promise.resolve({
                kind: CapabilityDispatchKind.Completed,
                terminal: {
                  status: ExecutionStatus.Succeeded,
                  result: {
                    artifact: {
                      digest: `sha256:${profileId === 'profile-a' ? 'a'.repeat(64) : 'b'.repeat(64)}`,
                      receipt: { owner: profileId },
                    },
                  },
                },
              }),
          }),
        ],
        runtimeSupports: [
          defineArtifactHandoffSupport({
            runtimeSupportId: 'artifacts.fixture',
            verify: () => Promise.resolve(),
            materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
          }),
          defineExecutionSupport({
            runtimeSupportId: 'execution.fixture',
            observe: () => Promise.reject(new Error('No detached execution is expected.')),
            cancel: () => Promise.resolve(),
          }),
        ],
      },
      persistence,
      idSource: {
        nextId: (kind) => `${kind}:shared`,
      },
    });

    await workbench.initialization.start({
      profileId: 'profile-a',
      initializerId: 'default',
      input: null,
    });
    await workbench.initialization.start({
      profileId: 'profile-b',
      initializerId: 'default',
      input: null,
    });

    await expect(
      workbench.models.getBase({ profileId: 'profile-a', baseId: 'base:shared' })
    ).resolves.toMatchObject({ artifact: { handoff: { receipt: { owner: 'profile-a' } } } });
    await expect(
      workbench.models.getBase({ profileId: 'profile-b', baseId: 'base:shared' })
    ).resolves.toMatchObject({ artifact: { handoff: { receipt: { owner: 'profile-b' } } } });
    expect(scopes).toEqual([
      { profileId: 'profile-a', configuration: { database: 'profile-a.sqlite' } },
      { profileId: 'profile-b', configuration: { database: 'profile-b.sqlite' } },
    ]);
  });
});

function misrouteAfterKnownRecord<TIdentity, TRecord>(
  find: (identity: TIdentity) => Promise<TRecord | undefined>,
  misroutedIdentity: string
): (identity: TIdentity) => Promise<TRecord | undefined> {
  let knownRecord: TRecord | undefined;
  return async (identity: TIdentity) => {
    const record = await find(identity);
    if (record !== undefined) knownRecord = record;
    return record ?? (String(identity) === misroutedIdentity ? knownRecord : undefined);
  };
}
