import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@ta-agent/workbench-domain';
import {
  OutputInvocationKind,
  type TypedOutputInvokerCapability,
} from '@ta-agent/workbench-extension';

import {
  CanonicalOutputInvokerAmbiguousError,
  ModelOutputMismatchError,
  ModelOutputNotFoundError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactMaterializationError,
  OutputInvocationCapabilityError,
} from '../../src/index.js';
import {
  InvocationFixtureProfileId as ProfileId,
  createInvocationFixture,
  invokeOutput,
  prepareOutput,
} from '../support/output-invocation-fixture.js';

describe('Model Workbench Output invocation', () => {
  it('materializes an immutable Output and returns a completed result without recording a Run', async () => {
    const invoke = vi.fn<TypedOutputInvokerCapability<JsonValue, JsonValue>>(
      ({ target, input }) => {
        const model = target.artifacts[0];
        if (model === undefined) throw new Error('Fixture Output must contain a model Artifact.');
        return Promise.resolve({
          kind: OutputInvocationKind.Completed,
          result: {
            input,
            model: {
              artifactId: model.artifact.artifactId,
              digest: model.artifact.digest,
              binding: model.artifact.binding,
            },
          },
        });
      }
    );
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);
    const resolvedTarget = await fixture.workbench.outputInvocations.resolve({
      profileId: ProfileId,
      outputId: 'output:1',
    });
    fixture.verify.mockClear();

    await expect(invokeOutput(fixture.workbench)).resolves.toMatchObject({
      kind: OutputInvocationKind.Completed,
      evidence: resolvedTarget,
      result: {
        input: { prompt: 'hello' },
        model: { binding: { location: 'fixture://output' } },
      },
    });
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      profileId: ProfileId,
      target: {
        output: { outputId: 'output:1', profileId: ProfileId },
        artifacts: [{ name: 'model', artifact: { binding: { location: 'fixture://output' } } }],
      },
      input: { prompt: 'hello' },
    });
    expect(invoke.mock.calls[0]?.[0]).not.toHaveProperty('runId');
    expect(invoke.mock.calls[0]?.[1]).toBeUndefined();
    expect(fixture.verify).toHaveBeenCalledOnce();
    await expect(
      fixture.workbench.runs.get({ profileId: ProfileId, runId: 'run:3' })
    ).resolves.toBeUndefined();
  });

  it('returns a lazily consumed stream without using Execution Support', async () => {
    const invoke: TypedOutputInvokerCapability<JsonValue, JsonValue> = () =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: streamOf({ token: 'hello' }, { token: ' world' }),
      });
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);

    const invocation = await invokeOutput(fixture.workbench);
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    expect(invocation.evidence).toMatchObject({
      profileId: ProfileId,
      outputId: 'output:1',
      outputInvokerId: 'generate',
    });
    await expect(collect(invocation.stream)).resolves.toEqual([
      { token: 'hello' },
      { token: ' world' },
    ]);
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it('preserves explicit Invoker selection when the canonical route is ambiguous', async () => {
    const invoke: TypedOutputInvokerCapability<JsonValue, JsonValue> = () =>
      Promise.resolve({
        kind: OutputInvocationKind.Completed,
        result: { text: 'explicit' },
      });
    const fixture = createInvocationFixture({
      invoke,
      outputInvokerIds: ['first', 'second'],
    });
    await prepareOutput(fixture.workbench);

    await expect(invokeOutput(fixture.workbench)).rejects.toBeInstanceOf(
      CanonicalOutputInvokerAmbiguousError
    );
    await expect(invokeOutput(fixture.workbench, 'second')).resolves.toMatchObject({
      kind: OutputInvocationKind.Completed,
      evidence: { outputInvokerId: 'second' },
      result: { text: 'explicit' },
    });
  });

  it('wraps a malformed streaming chunk when the consumer reaches it', async () => {
    const invoke = (() =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: unsafeStreamOf({ valid: true }, undefined),
      })) as unknown as TypedOutputInvokerCapability<JsonValue, JsonValue>;
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);

    const invocation = await invokeOutput(fixture.workbench);
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    await expect(collect(invocation.stream)).rejects.toBeInstanceOf(
      OutputInvocationCapabilityError
    );
  });

  it('wraps a backend stream failure after earlier chunks were delivered', async () => {
    const backendError = new Error('Fixture stream failed.');
    const invoke: TypedOutputInvokerCapability<JsonValue, JsonValue> = () =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: failingStream(backendError),
      });
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);

    const invocation = await invokeOutput(fixture.workbench);
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    const iterator = invocation.stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { token: 'first' } });
    await expect(iterator.next()).rejects.toMatchObject({
      name: OutputInvocationCapabilityError.name,
      cause: backendError,
    });
  });

  it('closes the underlying stream when its consumer stops early', async () => {
    const finalized = vi.fn();
    const invoke: TypedOutputInvokerCapability<JsonValue, JsonValue> = () =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: trackedStream(finalized),
      });
    const fixture = createInvocationFixture({ invoke });
    await prepareOutput(fixture.workbench);

    const invocation = await invokeOutput(fixture.workbench);
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    for await (const chunk of invocation.stream) {
      expect(chunk).toEqual({ token: 'first' });
      break;
    }
    expect(finalized).toHaveBeenCalledOnce();
  });

  it('rejects an unknown or mismatched Output before calling the Capability', async () => {
    const invoke = vi.fn<TypedOutputInvokerCapability<JsonValue, JsonValue>>();
    const missing = createInvocationFixture({ invoke });
    await expect(invokeOutput(missing.workbench)).rejects.toBeInstanceOf(ModelOutputNotFoundError);

    const wrongIdentity = createInvocationFixture({ invoke, returnMismatchedOutput: true });
    await prepareOutput(wrongIdentity.workbench);
    await expect(invokeOutput(wrongIdentity.workbench)).rejects.toBeInstanceOf(
      ModelOutputMismatchError
    );

    const wrongProfile = createInvocationFixture({ invoke, returnMismatchedProfile: true });
    await prepareOutput(wrongProfile.workbench);
    await expect(invokeOutput(wrongProfile.workbench)).rejects.toBeInstanceOf(
      ModelOutputProfileMismatchError
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports Artifact materialization and Capability failures without creating invocation Runs', async () => {
    const materialization = createInvocationFixture({
      invoke: vi.fn(),
      rejectMaterialization: 'fixture://output',
    });
    await prepareOutput(materialization.workbench);
    await expect(invokeOutput(materialization.workbench)).rejects.toBeInstanceOf(
      OutputInvocationArtifactMaterializationError
    );

    const backendError = new Error('Fixture invocation failed.');
    const capability = createInvocationFixture({
      invoke: () => Promise.reject(backendError),
    });
    await prepareOutput(capability.workbench);
    await expect(invokeOutput(capability.workbench)).rejects.toMatchObject({
      name: OutputInvocationCapabilityError.name,
      cause: backendError,
    });

    await expect(
      capability.workbench.runs.get({ profileId: ProfileId, runId: 'run:3' })
    ).resolves.toBeUndefined();
  });
});

async function* streamOf(...chunks: JsonValue[]): AsyncIterable<JsonValue> {
  await Promise.resolve();
  yield* chunks;
}

async function* unsafeStreamOf(...chunks: unknown[]): AsyncIterable<unknown> {
  await Promise.resolve();
  yield* chunks;
}

async function* failingStream(error: Error): AsyncIterable<JsonValue> {
  await Promise.resolve();
  yield { token: 'first' };
  throw error;
}

async function* trackedStream(finalized: () => void): AsyncIterable<JsonValue> {
  try {
    await Promise.resolve();
    yield { token: 'first' };
    yield { token: 'second' };
  } finally {
    finalized();
  }
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
