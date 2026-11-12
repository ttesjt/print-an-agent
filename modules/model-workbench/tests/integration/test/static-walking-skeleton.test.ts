import { describe, expect, it } from 'vitest';

import { createModelWorkbench } from '@print-an-agent/workbench-application';
import {
  CapabilityDispatchKind,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineInitializerCapability,
  ExecutionStatus,
} from '@print-an-agent/workbench-extension';
import { RuntimeBindingKind } from '@print-an-agent/workbench-setup';

describe('static Model Workbench walking skeleton', () => {
  it('calls a resolved Capability and retains only resulting dynamic assets', async () => {
    const setup = {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'fixture.runtime',
          supports: {
            artifactHandoffId: 'fixture.artifacts',
            executionSupportId: 'fixture.execution',
          },
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
          initialize: () =>
            Promise.resolve({
              kind: CapabilityDispatchKind.Completed,
              terminal: {
                status: ExecutionStatus.Succeeded,
                result: {
                  artifact: {
                    digest: `sha256:${'f'.repeat(64)}`,
                    receipt: { location: 'fixture://initialized' },
                  },
                },
              },
            }),
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'fixture.artifacts',
          verify: () => Promise.resolve(),
          materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'fixture.execution',
          observe: () => Promise.reject(new Error('No detached execution is expected.')),
          cancel: () => Promise.resolve(),
        }),
      ],
    };
    const generated = {
      run: 'run:fixture',
      base: 'base:fixture',
      modification: 'modification:fixture',
      output: 'output:fixture',
      artifact: 'artifact:fixture',
    } as const;
    const workbench = createModelWorkbench({
      setup,
      extensions,
      idSource: {
        nextId: (kind) => generated[kind],
      },
    });

    const result = await workbench.initialization.start({
      profileId: 'fixture-profile',
      initializerId: 'default',
      input: { seed: 42 },
    });

    expect(result).toEqual({ runId: 'run:fixture' });
    const storedRun = await workbench.runs.get({
      profileId: 'fixture-profile',
      runId: result.runId,
    });
    expect(storedRun).toMatchObject({ status: 'succeeded' });
    expect(storedRun?.slotEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await expect(
      workbench.models.getBase({ profileId: 'fixture-profile', baseId: 'base:fixture' })
    ).resolves.toMatchObject({
      profileId: 'fixture-profile',
      artifact: {
        artifactId: 'artifact:fixture',
        handoff: {
          runtimeSupportId: 'fixture.artifacts',
          receipt: { location: 'fixture://initialized' },
        },
      },
    });
  });
});
