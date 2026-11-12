import { describe, expect, it, vi } from 'vitest';

import {
  ModelOperationKind,
  defineModelOutput,
  defineModelState,
  parseArtifactReference,
  parseCapabilityId,
  parseExporterId,
  parseOutputArtifactName,
  parseOutputId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
} from '@print-an-agent/workbench-domain';

import {
  OutputInvocationKind,
  defineJsonSchemaContract,
  defineOutputInvokerCapability,
  type OutputInvocationCapabilityRequest,
  type TypedOutputInvokerCapability,
} from '../../src/index.js';

describe('Output Invoker Capability', () => {
  it('validates custom input and a completed result around a materialized target', async () => {
    const invoke: TypedOutputInvokerCapability<InvocationInput, InvocationOutput> = vi.fn(
      (request: OutputInvocationCapabilityRequest<InvocationInput>) =>
        Promise.resolve({
          kind: OutputInvocationKind.Completed,
          result: { text: `${request.input.prompt}:done` },
        })
    );
    const capability = outputInvoker(invoke);
    const target = materializedOutput();

    await expect(
      capability.invoke({
        profileId: parseProfileId('profile:fixture'),
        target,
        input: { prompt: 'hello' },
      })
    ).resolves.toEqual({ kind: OutputInvocationKind.Completed, result: { text: 'hello:done' } });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ target }), undefined);
  });

  it('validates every streaming chunk lazily with the same output Contract', async () => {
    const capability = outputInvoker(() =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: streamOf({ text: 'one' }, { text: 'two' }),
      })
    );
    const invocation = await capability.invoke(invocationRequest());
    expect(invocation.kind).toBe(OutputInvocationKind.Streaming);
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');

    await expect(collect(invocation.stream)).resolves.toEqual([{ text: 'one' }, { text: 'two' }]);
  });

  it('rejects an invalid completed result and an invalid streaming chunk', async () => {
    const invalidCompleted = outputInvoker((() =>
      Promise.resolve({
        kind: OutputInvocationKind.Completed,
        result: { text: 42 },
      })) as unknown as TypedOutputInvokerCapability<InvocationInput, InvocationOutput>);
    await expect(invalidCompleted.invoke(invocationRequest())).rejects.toThrow('must be string');

    const invalidStream = outputInvoker((() =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: streamOf({ text: 'valid' }, { text: 42 }),
      })) as unknown as TypedOutputInvokerCapability<InvocationInput, InvocationOutput>);
    const invocation = await invalidStream.invoke(invocationRequest());
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    await expect(collect(invocation.stream)).rejects.toThrow('must be string');
  });

  it.each(['before-next', 'partial', 'exhausted', 'invalid-chunk', 'backend-failure'] as const)(
    'propagates stream ownership on %s without synthetic reads or duplicate return',
    async (ending) => {
      const failure = new Error('backend failed');
      let count = 0;
      const next = vi.fn((): Promise<IteratorResult<InvocationOutput>> => {
        if (ending === 'backend-failure') return Promise.reject(failure);
        if (count++ > 0) return Promise.resolve({ done: true, value: undefined });
        return Promise.resolve({
          done: false,
          value: ending === 'invalid-chunk' ? ({ text: 42 } as never) : { text: 'one' },
        });
      });
      const returned = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }));
      const capability = outputInvoker(() =>
        Promise.resolve({
          kind: OutputInvocationKind.Streaming,
          stream: { [Symbol.asyncIterator]: () => ({ next, return: returned }) },
        })
      );
      const invocation = await capability.invoke(invocationRequest());
      if (invocation.kind !== OutputInvocationKind.Streaming)
        throw new Error('Expected streaming.');
      expect(next).not.toHaveBeenCalled();
      const iterator = invocation.stream[Symbol.asyncIterator]();
      if (ending === 'invalid-chunk')
        await expect(iterator.next()).rejects.toThrow('must be string');
      else if (ending === 'backend-failure') await expect(iterator.next()).rejects.toBe(failure);
      else if (ending !== 'before-next')
        await expect(iterator.next()).resolves.toMatchObject({ done: false });
      if (ending === 'exhausted')
        await expect(iterator.next()).resolves.toMatchObject({ done: true });
      await Promise.all([iterator.return?.(), iterator.return?.()]);
      expect(returned).toHaveBeenCalledTimes(ending === 'exhausted' ? 0 : 1);
      const expectedPulls = ending === 'before-next' ? 0 : ending === 'exhausted' ? 2 : 1;
      expect(next).toHaveBeenCalledTimes(expectedPulls);
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
      expect(next).toHaveBeenCalledTimes(expectedPulls);
    }
  );

  it('waits for one pending return and preserves a cleanup rejection without retry', async () => {
    const cleanup = Promise.withResolvers<IteratorResult<InvocationOutput>>();
    const returned = vi.fn(() => cleanup.promise);
    const next = vi.fn();
    const capability = outputInvoker(() =>
      Promise.resolve({
        kind: OutputInvocationKind.Streaming,
        stream: { [Symbol.asyncIterator]: () => ({ next, return: returned }) },
      })
    );
    const invocation = await capability.invoke(invocationRequest());
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected streaming.');
    const iterator = invocation.stream[Symbol.asyncIterator]();
    const first = iterator.return?.();
    const second = iterator.return?.();
    const failure = new Error('cleanup failed');
    const outcomes = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(returned).toHaveBeenCalledOnce());
    cleanup.reject(failure);
    expect(await outcomes).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    await expect(iterator.return?.()).rejects.toBe(failure);
    expect(returned).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});

interface InvocationInput {
  readonly prompt: string;
}

interface InvocationOutput {
  readonly text: string;
}

function outputInvoker(invoke: TypedOutputInvokerCapability<InvocationInput, InvocationOutput>) {
  return defineOutputInvokerCapability({
    capabilityId: 'output-invoker.fixture',
    input: invocationInputContract(),
    output: invocationOutputContract(),
    invoke,
  });
}

function invocationRequest() {
  return {
    profileId: parseProfileId('profile:fixture'),
    target: materializedOutput(),
    input: { prompt: 'hello' },
  };
}

function invocationInputContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['prompt'],
      properties: { prompt: { type: 'string' } },
      additionalProperties: false,
    } as const,
  });
}

function invocationOutputContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
      additionalProperties: false,
    } as const,
  });
}

function materializedOutput() {
  const artifact = parseArtifactReference({
    artifactId: 'artifact:output',
    digest: `sha256:${'a'.repeat(64)}`,
    handoff: {
      runtimeSupportId: 'artifacts.fixture',
      receipt: { objectId: 'object:output' },
    },
  });
  const name = parseOutputArtifactName('model');
  const output = defineModelOutput({
    outputId: parseOutputId('output:fixture'),
    profileId: parseProfileId('profile:fixture'),
    artifacts: [{ name, artifact }],
    lineage: {
      kind: ModelOperationKind.Export,
      runId: parseRunId('run:export'),
      exporterId: parseExporterId('exporter:fixture'),
      capabilityId: parseCapabilityId('capability:exporter'),
      runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
      slotEvidenceDigest: parseSha256Digest(`sha256:${'b'.repeat(64)}`),
      source: defineModelState({ baseId: 'base:source' }),
    },
  });
  return Object.freeze({
    output,
    artifacts: Object.freeze([
      Object.freeze({
        name,
        artifact: Object.freeze({
          artifactId: artifact.artifactId,
          digest: artifact.digest,
          binding: { localPath: '/tmp/output' },
        }),
      }),
    ]),
  });
}

async function* streamOf<T>(...chunks: T[]): AsyncIterable<T> {
  await Promise.resolve();
  yield* chunks;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
