import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ModelWorkbenchErrorCategory,
  OutputInvocationKind,
  classifyModelWorkbenchError,
  createModelWorkbench,
  type WorkbenchIdSource,
} from '@ta-agent/workbench-application';
import { ModelOperationKind, type JsonValue } from '@ta-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  ExecutionStatus,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExporterCapability,
  defineInitializerCapability,
  defineOutputInvokerCapability,
  type InvokeOutputCapability,
} from '@ta-agent/workbench-extension';
import { createLocalOutputInvocationBridge } from '@ta-agent/workbench-local-runtime';
import { RuntimeBindingKind } from '@ta-agent/workbench-setup';

const ProfileId = 'black-box-model';
const OutputId = 'output:1';

describe('Model Workbench public application boundary', () => {
  it('resolves and invokes one exact Output with stable completed and streaming evidence', async () => {
    const workbench = createBlackBoxWorkbench();

    await workbench.initialization.start({
      profileId: ProfileId,
      initializerId: 'seed',
      input: null,
    });
    await workbench.exports.start({
      profileId: ProfileId,
      exporterId: 'portable',
      source: { baseId: 'base:1' },
      input: null,
    });

    const targetEvidence = await workbench.outputInvocations.resolve({
      profileId: ProfileId,
      outputId: OutputId,
    });
    const completed = await workbench.outputInvocations.invoke({
      profileId: ProfileId,
      outputId: OutputId,
      input: { prompt: 'hello' },
    });
    expect(completed).toEqual({
      kind: OutputInvocationKind.Completed,
      evidence: targetEvidence,
      result: {
        outputId: OutputId,
        prompt: 'hello',
        location: 'fixture://portable-output',
      },
    });

    const streaming = await workbench.outputInvocations.invoke({
      profileId: ProfileId,
      outputId: OutputId,
      input: { prompt: 'hello', stream: true },
    });
    expect(streaming).toMatchObject({
      kind: OutputInvocationKind.Streaming,
      evidence: targetEvidence,
    });
    if (streaming.kind !== OutputInvocationKind.Streaming) return;
    await expect(collect(streaming.stream)).resolves.toEqual([
      { token: 'hello' },
      { token: ' world' },
    ]);

    await expect(workbench.runs.list({ profileId: ProfileId })).resolves.toMatchObject({
      records: [
        { operation: ModelOperationKind.Initialization },
        { operation: ModelOperationKind.Export },
      ],
    });
  });

  it('classifies public operation and invocation failures without consumer code lists', async () => {
    const workbench = createBlackBoxWorkbench();
    await workbench.initialization.start({
      profileId: ProfileId,
      initializerId: 'seed',
      input: null,
    });
    await workbench.exports.start({
      profileId: ProfileId,
      exporterId: 'portable',
      source: { baseId: 'base:1' },
      input: null,
    });

    const invalidRequest = await captureError(() =>
      workbench.outputInvocations.resolve({ profileId: '', outputId: OutputId })
    );
    expect(classifyModelWorkbenchError(invalidRequest).category).toBe(
      ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration
    );

    const notCallable = await captureError(() =>
      workbench.outputInvocations.resolve({ profileId: ProfileId, outputId: 'output:missing' })
    );
    expect(classifyModelWorkbenchError(notCallable).category).toBe(
      ModelWorkbenchErrorCategory.TargetNotCallable
    );

    const operationFailure = await captureError(() =>
      workbench.initialization.start({
        profileId: ProfileId,
        initializerId: 'seed',
        input: { fail: true },
      })
    );
    expect(classifyModelWorkbenchError(operationFailure).category).toBe(
      ModelWorkbenchErrorCategory.OperationFailure
    );

    const invocationFailure = await captureError(() =>
      workbench.outputInvocations.invoke({
        profileId: ProfileId,
        outputId: OutputId,
        input: { fail: true },
      })
    );
    expect(classifyModelWorkbenchError(invocationFailure).category).toBe(
      ModelWorkbenchErrorCategory.InvocationFailure
    );

    const controller = new AbortController();
    controller.abort('fixture cancellation');
    const cancellation = await captureError(() =>
      workbench.outputInvocations.invoke(
        { profileId: ProfileId, outputId: OutputId, input: null },
        { signal: controller.signal }
      )
    );
    expect(classifyModelWorkbenchError(cancellation).category).toBe(
      ModelWorkbenchErrorCategory.Cancellation
    );
    expect(classifyModelWorkbenchError(new Error('foreign')).category).toBe(
      ModelWorkbenchErrorCategory.UnexpectedFailure
    );
  });

  it('closes an already running local invoker through every wrapper before the first pull', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-public-stream-close-'));
    const marker = join(directory, 'terminated');
    const bridge = createLocalOutputInvocationBridge({
      command: {
        executable: process.execPath,
        arguments: [
          '--input-type=module',
          '--eval',
          String.raw`
            import { appendFileSync } from 'node:fs';
            let input = '';
            for await (const chunk of process.stdin) input += chunk;
            const request = JSON.parse(input);
            process.once('SIGTERM', () => {
              appendFileSync(request.terminationMarker, 'terminated\n');
              process.exit(0);
            });
            console.log('{"kind":"stream-start"}');
            console.log('{"kind":"chunk","result":"unread"}');
            setInterval(() => undefined, 1000);
          `,
        ],
      },
      cancellationGraceMilliseconds: 1_000,
    });
    const workbench = createBlackBoxWorkbench((request, options) =>
      bridge.invoke(request.input, options)
    );
    let iterator: AsyncIterator<JsonValue> | undefined;
    try {
      await workbench.initialization.start({
        profileId: ProfileId,
        initializerId: 'seed',
        input: null,
      });
      await workbench.exports.start({
        profileId: ProfileId,
        exporterId: 'portable',
        source: { baseId: 'base:1' },
        input: null,
      });
      const invocation = await workbench.outputInvocations.invoke({
        profileId: ProfileId,
        outputId: OutputId,
        input: { terminationMarker: marker },
      });
      if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
      iterator = invocation.stream[Symbol.asyncIterator]();
      await Promise.all([iterator.return?.(), iterator.return?.()]);
      expect(await readFile(marker, 'utf8')).toBe('terminated\n');
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
    } finally {
      await iterator?.return?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function createBlackBoxWorkbench(invoke?: InvokeOutputCapability) {
  return createModelWorkbench({
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
          profileId: ProfileId,
          initializers: [
            {
              initializerId: 'seed',
              capabilityId: 'initializer.fixture',
              runtimeBindingId: 'runtime.fixture',
            },
          ],
          exporters: [
            {
              exporterId: 'portable',
              capabilityId: 'exporter.fixture',
              runtimeBindingId: 'runtime.fixture',
            },
          ],
          outputInvokers: [
            {
              outputInvokerId: 'generate',
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
          initialize: ({ input }) => {
            if (readBoolean(input, 'fail')) {
              return Promise.reject(new Error('Fixture initialization failed.'));
            }
            return Promise.resolve({
              kind: CapabilityDispatchKind.Completed,
              terminal: {
                status: ExecutionStatus.Succeeded,
                result: {
                  artifact: artifactResult('fixture://base', 'a'),
                },
              },
            });
          },
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
                      artifact: artifactResult('fixture://portable-output', 'b'),
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
          invoke:
            invoke ??
            (({ target, input }) => {
              if (readBoolean(input, 'fail')) {
                return Promise.reject(new Error('Fixture invocation failed.'));
              }
              if (readBoolean(input, 'stream')) {
                return Promise.resolve({
                  kind: OutputInvocationKind.Streaming,
                  stream: streamOf({ token: 'hello' }, { token: ' world' }),
                });
              }
              const prompt = readString(input, 'prompt');
              const model = target.artifacts[0];
              if (model === undefined) throw new Error('Fixture model Artifact is missing.');
              return Promise.resolve({
                kind: OutputInvocationKind.Completed,
                result: {
                  outputId: target.output.outputId,
                  prompt,
                  location: readString(model.artifact.binding, 'location'),
                },
              });
            }),
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.fixture',
          verify: () => Promise.resolve(),
          materialize: ({ artifact }) => Promise.resolve({ location: artifact.handoff.receipt }),
        }),
        defineExecutionSupport({
          runtimeSupportId: 'execution.fixture',
          observe: () => Promise.reject(new Error('Fixture execution is always synchronous.')),
          cancel: () => Promise.resolve(),
        }),
      ],
    },
    idSource: sequentialIdSource(),
    clock: { now: () => '2026-09-04T12:00:00.000Z' },
  });
}

function artifactResult(receipt: string, digestSeed: string) {
  return Object.freeze({
    digest: `sha256:${digestSeed.repeat(64)}`,
    receipt,
  });
}

function sequentialIdSource(): WorkbenchIdSource {
  const counts = new Map<string, number>();
  return Object.freeze({
    nextId: (kind: Parameters<WorkbenchIdSource['nextId']>[0]) => {
      const next = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, next);
      return `${kind}:${String(next)}`;
    },
  });
}

function readBoolean(input: JsonValue, key: string): boolean {
  return isJsonObject(input) && input[key] === true;
}

function readString(input: JsonValue, key: string): string {
  const value = isJsonObject(input) ? input[key] : undefined;
  if (typeof value !== 'string') throw new Error(`Fixture input "${key}" must be a string.`);
  return value;
}

function isJsonObject(input: JsonValue): input is Readonly<Record<string, JsonValue>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function* streamOf(...values: JsonValue[]): AsyncIterable<JsonValue> {
  await Promise.resolve();
  yield* values;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}
