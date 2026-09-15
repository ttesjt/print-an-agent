import { resolve } from 'node:path';

import {
  ModelCapabilityKind,
  RuntimeSupportKind,
  defineJsonSchemaContract,
} from '@ta-agent/workbench-extension';
import { describe, expect, it } from 'vitest';

import {
  PythonModelBackendCapabilityId,
  PythonModelBackendCommand,
  PythonModelBackendDevice,
  PythonModelBackendDType,
  PythonModelBackendRuntimeSupportId,
  ExportInputSchema,
  InitializationInputSchema,
  InvocationInputSchema,
  TinyTransformerOutputFormat,
  TrainingInputSchema,
  createPythonModelBackendDefinition,
} from '../src/index.js';
import { createPythonModelBackendCommands } from '../src/create-python-model-backend-commands.js';

describe('createPythonModelBackendDefinition', () => {
  it('reuses one resolved extension set across Profiles', () => {
    const definition = createPythonModelBackendDefinition(
      {
        pythonExecutable: resolve('/usr/bin/python3'),
        backendSourceDirectory: resolve('/backend/src'),
        rootDirectory: resolve('/runtime'),
        device: PythonModelBackendDevice.Cuda,
        dtype: PythonModelBackendDType.BFloat16,
      },
      { profiles: [{ profileId: 'profile-a' }, { profileId: 'profile-b' }] }
    );

    expect(definition.setup.profiles).toHaveLength(2);
    expect(definition.extensions.modelCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: ModelCapabilityKind.Initializer,
          capabilityId: PythonModelBackendCapabilityId.Initializer,
        }),
      ])
    );
    expect(definition.extensions.runtimeSupports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: RuntimeSupportKind.ArtifactHandoff,
          runtimeSupportId: PythonModelBackendRuntimeSupportId.ArtifactHandoff,
        }),
      ])
    );
  });

  it('validates the model-specific initialization contract', () => {
    const contract = defineJsonSchemaContract({ schema: InitializationInputSchema });

    expect(() =>
      contract.parse(
        {
          model: {
            contextLength: 8,
            embeddingDimension: 12,
            attentionHeads: 3,
            layers: 1,
            feedForwardMultiplier: 2,
          },
          seed: 7,
        },
        'input'
      )
    ).not.toThrow();
    expect(() => contract.parse({ model: {}, seed: -1 }, 'input')).toThrow();
  });

  it('validates every public capability input contract', () => {
    const training = defineJsonSchemaContract({ schema: TrainingInputSchema });
    const exporting = defineJsonSchemaContract({ schema: ExportInputSchema });
    const invocation = defineJsonSchemaContract({ schema: InvocationInputSchema });

    expect(() =>
      training.parse({ steps: 3, batchSize: 2, learningRate: 0.01, seed: 11 }, 'training input')
    ).not.toThrow();
    expect(() =>
      training.parse({ steps: 0, batchSize: 2, learningRate: 0.01, seed: 11 }, 'training input')
    ).toThrow();

    expect(() =>
      exporting.parse({ format: TinyTransformerOutputFormat }, 'export input')
    ).not.toThrow();
    expect(() => exporting.parse({ format: 'unsupported' }, 'export input')).toThrow();

    expect(() =>
      invocation.parse(
        { prompt: 'Hello 1 你好', maxNewTokens: 4, stream: true },
        'invocation input'
      )
    ).not.toThrow();
    expect(() =>
      invocation.parse({ prompt: '', maxNewTokens: 4, stream: false }, 'invocation input')
    ).toThrow();
  });

  it('uses a renamed backend module for every Python command', () => {
    const commands = createPythonModelBackendCommands({
      pythonExecutable: resolve('/usr/bin/python3'),
      backendModule: 'qualified_model_backend',
      backendSourceDirectory: resolve('/backend/src'),
      rootDirectory: resolve('/runtime'),
    });

    for (const command of Object.values(PythonModelBackendCommand)) {
      expect(commands[command].arguments).toEqual(['-m', 'qualified_model_backend', command]);
    }
  });

  it('rejects an invalid backend module before constructing the runtime', () => {
    expect(() =>
      createPythonModelBackendCommands({
        pythonExecutable: resolve('/usr/bin/python3'),
        backendModule: 'qualified-model-backend',
        backendSourceDirectory: resolve('/backend/src'),
        rootDirectory: resolve('/runtime'),
      })
    ).toThrow('backendModule must be a valid dotted Python module name.');
  });
});
