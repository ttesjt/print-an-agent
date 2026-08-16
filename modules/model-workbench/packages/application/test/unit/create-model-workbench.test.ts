import { describe, expect, it } from 'vitest';

import {
  JsonValueContract,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

import { createModelWorkbench } from '../../src/index.js';

describe('createModelWorkbench', () => {
  it('resolves setup input and applies the default in-memory persistence composition', async () => {
    const generated = ['run:application', 'base:application', 'artifact:application'];
    const workbench = createModelWorkbench({
      setup: {
        runtimeBindings: [
          {
            kind: RuntimeBindingKind.Binding,
            runtimeBindingId: 'runtime.fixture',
            supports: { artifactVerifierId: 'artifacts.fixture' },
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
            initialize: ({ plannedArtifactId }) =>
              Promise.resolve({
                status: 'succeeded',
                artifact: {
                  artifactId: plannedArtifactId,
                  digest: `sha256:${'a'.repeat(64)}`,
                },
              }),
          }),
        ],
        runtimeSupports: [
          defineArtifactVerifierSupport({
            runtimeSupportId: 'artifacts.fixture',
            verify: () => Promise.resolve(),
          }),
        ],
      },
      idSource: {
        nextId: () => {
          const id = generated.shift();
          if (id === undefined) throw new Error('The fixture exhausted its generated IDs.');
          return id;
        },
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'fixture-profile',
      initializerId: 'default',
      input: null,
    });

    expect(result).toEqual({
      status: 'succeeded',
      runId: 'run:application',
      baseId: 'base:application',
    });
    await expect(workbench.models.getBase('base:application')).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: { artifactId: 'artifact:application' },
    });
  });
});
