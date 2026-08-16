import { describe, expect, it } from 'vitest';

import { createModelWorkbench } from '@ta-agent/workbench-application';
import {
  JsonValueContract,
  defineArtifactVerifierSupport,
  defineInitializerCapability,
} from '@ta-agent/workbench-extension';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

describe('static Model Workbench walking skeleton', () => {
  it('calls a resolved Capability and retains only resulting dynamic assets', async () => {
    const setup = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'fixture.runtime',
          supports: { artifactVerifierId: 'fixture.artifacts' },
        },
      ],
      profiles: [
        {
          profileId: 'fixture-profile',
          initializers: [
            {
              initializerId: 'default',
              capabilityId: 'fixture.initializer',
              runtimeBindingId: 'fixture.runtime',
            },
          ],
        },
      ],
    };
    const extensions = {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'fixture.initializer',
          metadata: { modelFramework: 'fixture' },
          input: JsonValueContract,
          initialize: ({ plannedArtifactId }) =>
            Promise.resolve({
              status: 'succeeded',
              artifact: {
                artifactId: plannedArtifactId,
                digest: `sha256:${'f'.repeat(64)}`,
              },
            }),
        }),
      ],
      runtimeSupports: [
        defineArtifactVerifierSupport({
          runtimeSupportId: 'fixture.artifacts',
          verify: () => Promise.resolve(),
        }),
      ],
    };
    const generated = ['run:fixture', 'base:fixture', 'artifact:fixture'];
    const workbench = createModelWorkbench({
      setup,
      extensions,
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
      input: { seed: 42 },
    });

    expect(result).toEqual({
      status: 'succeeded',
      runId: 'run:fixture',
      baseId: 'base:fixture',
    });
    if (result.status !== 'succeeded') throw new Error('Expected initialization to succeed.');
    const storedRun = await workbench.runs.get(result.runId);
    expect(storedRun).toMatchObject({ status: 'succeeded' });
    expect(storedRun?.slotEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await expect(workbench.models.getBase(result.baseId)).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: { artifactId: 'artifact:fixture' },
    });
  });
});
