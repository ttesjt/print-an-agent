import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@ta-agent/workbench-domain';
import type { TypedOutputInvokerCapability } from '@ta-agent/workbench-extension';
import { createMemoryPersistence } from '@ta-agent/workbench-persistence';

import {
  CanonicalOutputInvokerAmbiguousError,
  CanonicalOutputInvokerUnavailableError,
  ModelOutputMismatchError,
  ModelOutputNotFoundError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactSupportNotFoundError,
  OutputInvocationArtifactVerificationError,
  OutputInvocationTargetEvidenceKind,
} from '../../src/index.js';
import {
  InvocationFixtureOutputInvokerId,
  InvocationFixtureProfileId,
  createInvocationFixture,
  prepareOutput,
} from '../support/output-invocation-fixture.js';

describe('Output invocation target resolution', () => {
  it('verifies the canonical exact Output target without invoking or materializing it', async () => {
    const invoke = vi.fn<TypedOutputInvokerCapability<JsonValue, JsonValue>>();
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);
    fixture.verify.mockClear();
    fixture.materialize.mockClear();

    const target = await fixture.workbench.outputInvocations.resolve({
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
    });
    const repeated = await fixture.workbench.outputInvocations.resolve({
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
    });

    expect(target).toMatchObject({
      kind: OutputInvocationTargetEvidenceKind,
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
      outputInvokerId: InvocationFixtureOutputInvokerId,
    });
    expect(target.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(repeated).toEqual(target);
    expect(fixture.verify).toHaveBeenCalledTimes(2);
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await expect(
      fixture.workbench.runs.get({ profileId: InvocationFixtureProfileId, runId: 'run:3' })
    ).resolves.toBeUndefined();
  });

  it('binds target evidence to the Support that actually verifies each Artifact', async () => {
    const persistence = createMemoryPersistence();
    const first = createInvocationFixture({
      invoke: vi.fn(),
      persistence,
      separateInvokerArtifactSupport: true,
      artifactSupportMetadata: { deployment: 'first' },
    });
    await prepareOutput(first.workbench);
    const firstTarget = await first.workbench.outputInvocations.resolve({
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
    });

    const second = createInvocationFixture({
      invoke: vi.fn(),
      persistence,
      separateInvokerArtifactSupport: true,
      artifactSupportMetadata: { deployment: 'second' },
    });
    const secondTarget = await second.workbench.outputInvocations.resolve({
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
    });

    expect(secondTarget.outputInvokerId).toBe(firstTarget.outputInvokerId);
    expect(secondTarget.evidenceDigest).not.toBe(firstTarget.evidenceDigest);
  });

  it("uses a Profile's explicit canonical Invoker when several are available", async () => {
    const fixture = createInvocationFixture({
      invoke: vi.fn(),
      outputInvokerIds: ['first', 'second'],
      canonicalOutputInvokerId: 'second',
    });
    await prepareOutput(fixture.workbench);

    await expect(
      fixture.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).resolves.toMatchObject({ outputInvokerId: 'second' });
  });

  it('rejects an unknown or mismatched exact Output', async () => {
    const missing = createInvocationFixture({ invoke: vi.fn() });
    await expect(
      missing.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(ModelOutputNotFoundError);

    const wrongIdentity = createInvocationFixture({
      invoke: vi.fn(),
      returnMismatchedOutput: true,
    });
    await prepareOutput(wrongIdentity.workbench);
    await expect(
      wrongIdentity.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(ModelOutputMismatchError);

    const wrongProfile = createInvocationFixture({
      invoke: vi.fn(),
      returnMismatchedProfile: true,
    });
    await prepareOutput(wrongProfile.workbench);
    await expect(
      wrongProfile.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(ModelOutputProfileMismatchError);
  });

  it.each([
    {
      name: 'no Output Invoker',
      outputInvokerIds: [] as const,
      error: CanonicalOutputInvokerUnavailableError,
    },
    {
      name: 'several non-canonical Output Invokers',
      outputInvokerIds: ['first', 'second'] as const,
      error: CanonicalOutputInvokerAmbiguousError,
    },
  ])('rejects canonical target resolution with $name', async ({ outputInvokerIds, error }) => {
    const fixture = createInvocationFixture({ invoke: vi.fn(), outputInvokerIds });
    await prepareOutput(fixture.workbench);

    await expect(
      fixture.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(error);
  });

  it('does not let extra runtime properties bypass the public canonical route', async () => {
    const fixture = createInvocationFixture({
      invoke: vi.fn(),
      outputInvokerIds: ['first', 'second'],
    });
    await prepareOutput(fixture.workbench);
    const requestWithExplicitSelection = {
      profileId: InvocationFixtureProfileId,
      outputId: 'output:1',
      outputInvokerId: 'first',
    };

    await expect(
      fixture.workbench.outputInvocations.resolve(requestWithExplicitSelection)
    ).rejects.toBeInstanceOf(CanonicalOutputInvokerAmbiguousError);
  });

  it('reports unavailable Artifact Support and verification failure as readiness errors', async () => {
    const unavailable = createInvocationFixture({
      invoke: vi.fn(),
      returnUnavailableSupport: true,
    });
    await prepareOutput(unavailable.workbench);
    await expect(
      unavailable.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(OutputInvocationArtifactSupportNotFoundError);

    const verification = createInvocationFixture({ invoke: vi.fn() });
    await prepareOutput(verification.workbench);
    verification.verify.mockRejectedValueOnce(new Error('Fixture verification failed.'));
    await expect(
      verification.workbench.outputInvocations.resolve({
        profileId: InvocationFixtureProfileId,
        outputId: 'output:1',
      })
    ).rejects.toBeInstanceOf(OutputInvocationArtifactVerificationError);
  });
});
