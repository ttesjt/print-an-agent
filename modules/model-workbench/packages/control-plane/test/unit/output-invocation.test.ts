import { describe, expect, it, vi } from 'vitest';

import {
  defineModelOutput,
  parseOutputId,
  parseProfileId,
  type JsonValue,
} from '@ta-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  ExecutionStatus,
  JsonValueContract,
  OutputInvocationKind,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExporterCapability,
  defineInitializerCapability,
  defineOutputInvokerCapability,
  type TypedOutputInvokerCapability,
} from '@ta-agent/workbench-extension';
import {
  createMemoryPersistence,
  createSharedProfilePersistenceAdapter,
} from '@ta-agent/workbench-persistence';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@ta-agent/workbench-setup';

import {
  ModelOutputMismatchError,
  ModelOutputNotFoundError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactMaterializationError,
  OutputInvocationCapabilityError,
  createWorkbenchControlPlane,
  type ModelWorkbenchControlPlane,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

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

    await expect(invokeOutput(fixture.workbench)).resolves.toMatchObject({
      kind: OutputInvocationKind.Completed,
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
    await expect(collect(invocation.stream)).resolves.toEqual([
      { token: 'hello' },
      { token: ' world' },
    ]);
    expect(fixture.observe).not.toHaveBeenCalled();
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

const ProfileId = 'research-model';
const OutputInvokerId = 'generate';

interface InvocationFixtureInput {
  readonly invoke: TypedOutputInvokerCapability<JsonValue, JsonValue>;
  readonly rejectMaterialization?: string;
  readonly returnMismatchedOutput?: boolean;
  readonly returnMismatchedProfile?: boolean;
}

function createInvocationFixture(input: InvocationFixtureInput) {
  const persistence = createMemoryPersistence();
  const configuredPersistence =
    input.returnMismatchedOutput === true || input.returnMismatchedProfile === true
      ? Object.freeze({
          ...persistence,
          outputs: Object.freeze({
            findOutput: async (outputId: Parameters<typeof persistence.outputs.findOutput>[0]) => {
              const output = await persistence.outputs.findOutput(outputId);
              return output === undefined
                ? undefined
                : defineModelOutput({
                    outputId:
                      input.returnMismatchedOutput === true
                        ? parseOutputId('output:mismatched')
                        : output.outputId,
                    profileId:
                      input.returnMismatchedProfile === true
                        ? parseProfileId('profile:other')
                        : output.profileId,
                    artifacts: output.artifacts,
                    lineage: output.lineage,
                  });
            },
          }),
        })
      : persistence;
  const observe = vi.fn();
  const setup = resolveWorkbenchSetup(
    {
      runtimeBindings: [
        {
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: 'runtime.local',
          supports: {
            artifactHandoffId: 'artifacts.local',
            executionSupportId: 'execution.local',
          },
        },
      ],
      profiles: [
        {
          profileId: ProfileId,
          initializers: [
            {
              initializerId: 'import',
              capabilityId: 'initializer.import',
              runtimeBindingId: 'runtime.local',
            },
          ],
          exporters: [
            {
              exporterId: 'fixture',
              capabilityId: 'exporter.fixture',
              runtimeBindingId: 'runtime.local',
            },
          ],
          outputInvokers: [
            {
              outputInvokerId: OutputInvokerId,
              capabilityId: 'output-invoker.fixture',
              runtimeBindingId: 'runtime.local',
            },
          ],
        },
      ],
    },
    {
      modelCapabilities: [
        defineInitializerCapability({
          capabilityId: 'initializer.import',
          input: JsonValueContract,
          initialize: () =>
            Promise.resolve({
              kind: CapabilityDispatchKind.Completed,
              terminal: {
                status: ExecutionStatus.Succeeded,
                result: { artifact: artifactResult('fixture://source', 'a') },
              },
            }),
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
                  artifacts: [{ name: 'model', artifact: artifactResult('fixture://output', 'b') }],
                },
              },
            }),
        }),
        defineOutputInvokerCapability({
          capabilityId: 'output-invoker.fixture',
          input: JsonValueContract,
          output: JsonValueContract,
          invoke: input.invoke,
        }),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.local',
          verify: () => Promise.resolve(),
          materialize: ({ artifact }) => {
            if (artifact.handoff.receipt === input.rejectMaterialization) {
              return Promise.reject(new Error('Fixture Artifact cannot be materialized.'));
            }
            return Promise.resolve({ location: artifact.handoff.receipt });
          },
        }),
        defineExecutionSupport({
          runtimeSupportId: 'execution.local',
          observe,
          cancel: vi.fn(),
        }),
      ],
    }
  );
  return {
    observe,
    workbench: createWorkbenchControlPlane({
      setup,
      persistence: createSharedProfilePersistenceAdapter(configuredPersistence),
      idSource: sequentialIdSource(),
    }),
  };
}

async function prepareOutput(workbench: ModelWorkbenchControlPlane): Promise<void> {
  await workbench.initialization.start({
    profileId: ProfileId,
    initializerId: 'import',
    input: null,
  });
  await workbench.exports.start({
    profileId: ProfileId,
    exporterId: 'fixture',
    source: { baseId: 'base:1' },
    input: null,
  });
}

function invokeOutput(workbench: ModelWorkbenchControlPlane) {
  return workbench.outputInvocations.invoke({
    profileId: ProfileId,
    outputId: 'output:1',
    outputInvokerId: OutputInvokerId,
    input: { prompt: 'hello' },
  });
}

function artifactResult(receipt: string, digestSeed: string) {
  return { digest: `sha256:${digestSeed.repeat(64)}`, receipt } as const;
}

function sequentialIdSource() {
  const counts: Record<WorkbenchGeneratedIdKind, number> = {
    run: 0,
    base: 0,
    modification: 0,
    output: 0,
    artifact: 0,
  };
  return Object.freeze({
    nextId(kind: WorkbenchGeneratedIdKind): string {
      counts[kind] += 1;
      return `${kind}:${String(counts[kind])}`;
    },
  });
}

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
