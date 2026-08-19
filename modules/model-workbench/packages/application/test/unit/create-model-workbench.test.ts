import { describe, expect, it } from 'vitest';

import {
  CapabilityDispatchKind,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  defineTrainerCapability,
  ExecutionStatus,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

import { createModelWorkbench } from '../../src/index.js';

describe('createModelWorkbench', () => {
  it('resolves setup and runs Initialization through Training with memory persistence', async () => {
    const generated = {
      run: ['run:initialization', 'run:training'],
      base: ['base:source'],
      modification: ['modification:trained'],
      artifact: ['artifact:source', 'artifact:trained'],
    } as const;
    const generatedIndex = { run: 0, base: 0, modification: 0, artifact: 0 };
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
    await expect(workbench.models.getBase('base:source')).resolves.toMatchObject({
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
    await expect(workbench.models.getModification('modification:trained')).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: { artifactId: 'artifact:trained' },
      lineage: {
        kind: 'training',
        runId: 'run:training',
        source: { baseId: 'base:source', modificationIds: [] },
      },
    });
  });
});
