import { vi } from 'vitest';

import {
  defineModelOutput,
  parseArtifactReference,
  parseOutputId,
  parseProfileId,
  type JsonValue,
} from '@print-an-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  ExecutionStatus,
  JsonValueContract,
  defineArtifactHandoffSupport,
  defineExecutionSupport,
  defineExporterCapability,
  defineInitializerCapability,
  defineOutputInvokerCapability,
  type ArtifactMaterializationRequest,
  type TypedOutputInvokerCapability,
} from '@print-an-agent/workbench-extension';
import {
  createMemoryPersistence,
  createSharedProfilePersistenceAdapter,
  type ProfilePersistence,
} from '@print-an-agent/workbench-persistence';
import { RuntimeBindingKind, resolveWorkbenchSetup } from '@print-an-agent/workbench-setup';

import {
  createWorkbenchControlPlane,
  type ModelWorkbenchControlPlane,
  type WorkbenchGeneratedIdKind,
} from '../../src/index.js';

export const InvocationFixtureProfileId = 'research-model';
export const InvocationFixtureOutputInvokerId = 'generate';

export interface InvocationFixtureInput {
  readonly invoke: TypedOutputInvokerCapability<JsonValue, JsonValue>;
  readonly canonicalOutputInvokerId?: string;
  readonly artifactSupportMetadata?: JsonValue;
  readonly outputInvokerIds?: readonly string[];
  readonly persistence?: ProfilePersistence;
  readonly rejectMaterialization?: string;
  readonly returnMismatchedOutput?: boolean;
  readonly returnMismatchedProfile?: boolean;
  readonly returnUnavailableSupport?: boolean;
  readonly separateInvokerArtifactSupport?: boolean;
}

export function createInvocationFixture(input: InvocationFixtureInput) {
  const persistence = input.persistence ?? createMemoryPersistence();
  const outputInvokerIds = input.outputInvokerIds ?? [InvocationFixtureOutputInvokerId];
  const configuredPersistence =
    input.returnMismatchedOutput === true ||
    input.returnMismatchedProfile === true ||
    input.returnUnavailableSupport === true
      ? Object.freeze({
          ...persistence,
          outputs: Object.freeze({
            ...persistence.outputs,
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
                    artifacts:
                      input.returnUnavailableSupport === true
                        ? output.artifacts.map(({ name, artifact }) =>
                            Object.freeze({
                              name,
                              artifact: parseArtifactReference({
                                ...artifact,
                                handoff: {
                                  ...artifact.handoff,
                                  runtimeSupportId: 'artifacts.unavailable',
                                },
                              }),
                            })
                          )
                        : output.artifacts,
                    lineage: output.lineage,
                  });
            },
          }),
        })
      : persistence;
  const observe = vi.fn();
  const verify = vi.fn(() => Promise.resolve());
  const materialize = vi.fn(({ artifact }: ArtifactMaterializationRequest) => {
    if (artifact.handoff.receipt === input.rejectMaterialization) {
      return Promise.reject(new Error('Fixture Artifact cannot be materialized.'));
    }
    return Promise.resolve({ location: artifact.handoff.receipt });
  });
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
        ...(input.separateInvokerArtifactSupport === true
          ? [
              {
                kind: RuntimeBindingKind.Binding,
                runtimeBindingId: 'runtime.invocation',
                supports: { artifactHandoffId: 'artifacts.invocation' },
              } as const,
            ]
          : []),
      ],
      profiles: [
        {
          profileId: InvocationFixtureProfileId,
          ...(input.canonicalOutputInvokerId === undefined
            ? {}
            : { canonicalOutputInvokerId: input.canonicalOutputInvokerId }),
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
          outputInvokers: outputInvokerIds.map((outputInvokerId) => ({
            outputInvokerId,
            capabilityId: `output-invoker.${outputInvokerId}`,
            runtimeBindingId:
              input.separateInvokerArtifactSupport === true
                ? 'runtime.invocation'
                : 'runtime.local',
          })),
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
        ...outputInvokerIds.map((outputInvokerId) =>
          defineOutputInvokerCapability({
            capabilityId: `output-invoker.${outputInvokerId}`,
            input: JsonValueContract,
            output: JsonValueContract,
            invoke: input.invoke,
          })
        ),
      ],
      runtimeSupports: [
        defineArtifactHandoffSupport({
          runtimeSupportId: 'artifacts.local',
          ...(input.artifactSupportMetadata === undefined
            ? {}
            : { metadata: input.artifactSupportMetadata }),
          verify,
          materialize,
        }),
        ...(input.separateInvokerArtifactSupport === true
          ? [
              defineArtifactHandoffSupport({
                runtimeSupportId: 'artifacts.invocation',
                verify: () => Promise.resolve(),
                materialize: ({ artifact }) => Promise.resolve(artifact.handoff.receipt),
              }),
            ]
          : []),
        defineExecutionSupport({
          runtimeSupportId: 'execution.local',
          observe,
          cancel: vi.fn(),
        }),
      ],
    }
  );
  return {
    materialize,
    observe,
    verify,
    workbench: createWorkbenchControlPlane({
      setup,
      persistence: createSharedProfilePersistenceAdapter(configuredPersistence),
      idSource: sequentialIdSource(),
      clock: { now: () => '2026-08-24T10:00:00.000Z' },
    }),
  };
}

export async function prepareOutput(workbench: ModelWorkbenchControlPlane): Promise<void> {
  await workbench.initialization.start({
    profileId: InvocationFixtureProfileId,
    initializerId: 'import',
    input: null,
  });
  await workbench.exports.start({
    profileId: InvocationFixtureProfileId,
    exporterId: 'fixture',
    source: { baseId: 'base:1' },
    input: null,
  });
}

export function invokeOutput(workbench: ModelWorkbenchControlPlane, outputInvokerId?: string) {
  return workbench.outputInvocations.invoke({
    profileId: InvocationFixtureProfileId,
    outputId: 'output:1',
    ...(outputInvokerId === undefined ? {} : { outputInvokerId }),
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
