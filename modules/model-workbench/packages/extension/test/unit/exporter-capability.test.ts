import { describe, expect, it, vi } from 'vitest';

import {
  ModelOperationKind,
  defineModelState,
  parseArtifactReference,
  parseBaseId,
  parseProfileId,
  parseRunId,
} from '@print-an-agent/workbench-domain';

import {
  CapabilityDispatchKind,
  ExecutionStatus,
  defineExporterCapability,
  defineJsonSchemaContract,
  type ExportCapabilityRequest,
  type TypedExporterCapability,
} from '../../src/index.js';

describe('Exporter Capability', () => {
  it('validates custom input and normalizes a named Artifact result set', async () => {
    const exportModel: TypedExporterCapability<ExportInput, ExportResultData> = vi.fn(
      (request: ExportCapabilityRequest<ExportInput>) =>
        Promise.resolve({
          kind: CapabilityDispatchKind.Completed,
          terminal: {
            status: ExecutionStatus.Succeeded,
            result: {
              artifacts: [artifactResult('tokenizer', 'b'), artifactResult('model', 'a')],
              data: { format: request.input.format },
            },
          },
        })
    );
    const capability = defineExporterCapability({
      capabilityId: 'exporter.fixture',
      input: exportInputContract(),
      resultData: exportResultContract(),
      export: exportModel,
    });

    await expect(
      capability.export({
        operation: ModelOperationKind.Export,
        profileId: parseProfileId('profile:fixture'),
        runId: parseRunId('run:export'),
        source: materializedSource(),
        input: { format: 'gguf' },
      })
    ).resolves.toMatchObject({
      terminal: {
        result: {
          artifacts: [{ name: 'model' }, { name: 'tokenizer' }],
          data: { format: 'gguf' },
        },
      },
    });
  });

  it('rejects empty and duplicate named Artifact sets', () => {
    const capability = defineExporterCapability({
      capabilityId: 'exporter.fixture',
      input: exportInputContract(),
      export: vi.fn(),
    });

    expect(() => capability.parseResult({ artifacts: [] })).toThrow('must be a non-empty array');
    expect(() =>
      capability.parseResult({
        artifacts: [artifactResult('model', 'a'), artifactResult('model', 'b')],
      })
    ).toThrow('must contain unique names');
  });
});

interface ExportInput {
  readonly format: string;
}

interface ExportResultData {
  readonly format: string;
}

function exportInputContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['format'],
      properties: { format: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    } as const,
  });
}

function exportResultContract() {
  return defineJsonSchemaContract({
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['format'],
      properties: { format: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    } as const,
  });
}

function artifactResult(name: string, digestCharacter: string) {
  return {
    name,
    artifact: {
      digest: `sha256:${digestCharacter.repeat(64)}`,
      receipt: { objectId: `object:${name}` },
    },
  };
}

function materializedSource() {
  const state = defineModelState({ baseId: 'base:source' });
  const artifact = parseArtifactReference({
    artifactId: 'artifact:source',
    digest: `sha256:${'a'.repeat(64)}`,
    handoff: {
      runtimeSupportId: 'artifacts.fixture',
      receipt: { objectId: 'object:source' },
    },
  });
  return Object.freeze({
    state,
    base: Object.freeze({
      baseId: parseBaseId('base:source'),
      artifact: Object.freeze({
        artifactId: artifact.artifactId,
        digest: artifact.digest,
        binding: { localPath: '/tmp/source' },
      }),
    }),
    modifications: Object.freeze([]),
  });
}
