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
} from '@ta-agent/workbench-domain';

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
