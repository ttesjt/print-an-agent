import { describe, expect, it } from 'vitest';

import {
  CapabilityDispatchKind,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  ExecutionStatus,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

import { createModelWorkbench } from '../../src/index.js';

describe('createModelWorkbench', () => {
  it('resolves setup input and applies the default in-memory persistence composition', async () => {
    const generated = {
      run: 'run:application',
      base: 'base:application',
      artifact: 'artifact:application',
    } as const;
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
        ],
        runtimeSupports: [
          defineArtifactHandoffSupport({
            runtimeSupportId: 'artifacts.fixture',
            verify: () => Promise.resolve(),
          }),
          defineExecutionSupport({
            runtimeSupportId: 'execution.fixture',
            observe: () => Promise.reject(new Error('No detached execution is expected.')),
            cancel: () => Promise.resolve(),
          }),
        ],
      },
      idSource: {
        nextId: (kind) => generated[kind],
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'fixture-profile',
      initializerId: 'default',
      input: null,
    });

    expect(result).toEqual({ runId: 'run:application' });
    await expect(workbench.models.getBase('base:application')).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: {
        artifactId: 'artifact:application',
        handoff: {
          runtimeSupportId: 'artifacts.fixture',
          receipt: { location: 'fixture://initialized' },
        },
      },
    });
  });
});
