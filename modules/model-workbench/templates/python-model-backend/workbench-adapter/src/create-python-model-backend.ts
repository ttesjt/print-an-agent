import {
  defineExporterCapability,
  defineInitializerCapability,
  defineJsonSchemaContract,
  defineOutputInvokerCapability,
  defineTrainerCapability,
} from '@print-an-agent/workbench-extension';
import {
  createLocalArtifactHandoffSupport,
  createLocalCommandBridge,
  createLocalExecutionSupport,
  createLocalOutputInvocationBridge,
} from '@print-an-agent/workbench-local-runtime';
import { RuntimeBindingKind, type ModelProfileInput } from '@print-an-agent/workbench-setup';

import {
  PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
  PythonModelBackendCapabilityId,
  PythonModelBackendRuntimeSupportId,
  PythonModelBackendSlotId,
} from './constants.js';
import { createPythonModelBackendCommands } from './create-python-model-backend-commands.js';
import type {
  PythonModelBackendDefinition,
  PythonModelBackendExtensionOptions,
  PythonModelBackendProfileInput,
  PythonModelBackendSetupInput,
} from './contracts.js';
import {
  ExportInputSchema,
  ExportResultDataSchema,
  InitializationInputSchema,
  InitializationResultDataSchema,
  InvocationInputSchema,
  InvocationOutputSchema,
  TrainingInputSchema,
  TrainingResultDataSchema,
} from './schemas.js';

export function createPythonModelBackendDefinition(
  extensionOptions: PythonModelBackendExtensionOptions,
  setupInput: PythonModelBackendSetupInput
): PythonModelBackendDefinition {
  const commands = createPythonModelBackendCommands(extensionOptions);
  const initializeBridge = createLocalCommandBridge({
    rootDirectory: extensionOptions.rootDirectory,
    command: commands.initialize,
  });
  const trainBridge = createLocalCommandBridge({
    rootDirectory: extensionOptions.rootDirectory,
    command: commands.train,
  });
  const exportBridge = createLocalCommandBridge({
    rootDirectory: extensionOptions.rootDirectory,
    command: commands.export,
  });
  const invocationBridge = createLocalOutputInvocationBridge({ command: commands.invoke });

  return Object.freeze({
    setup: Object.freeze({
      runtimeBindings: Object.freeze([
        Object.freeze({
          kind: RuntimeBindingKind.Binding,
          runtimeBindingId: PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
          supports: Object.freeze({
            artifactHandoffId: PythonModelBackendRuntimeSupportId.ArtifactHandoff,
            executionSupportId: PythonModelBackendRuntimeSupportId.Execution,
          }),
        }),
      ]),
      profiles: Object.freeze(setupInput.profiles.map(createProfile)),
    }),
    extensions: Object.freeze({
      modelCapabilities: Object.freeze([
        defineInitializerCapability({
          capabilityId: PythonModelBackendCapabilityId.Initializer,
          input: defineJsonSchemaContract({ schema: InitializationInputSchema }),
          resultData: defineJsonSchemaContract({ schema: InitializationResultDataSchema }),
          initialize: (request, options) => initializeBridge.dispatch(request, options),
        }),
        defineTrainerCapability({
          capabilityId: PythonModelBackendCapabilityId.Trainer,
          input: defineJsonSchemaContract({ schema: TrainingInputSchema }),
          resultData: defineJsonSchemaContract({ schema: TrainingResultDataSchema }),
          train: (request, options) => trainBridge.dispatch(request, options),
        }),
        defineExporterCapability({
          capabilityId: PythonModelBackendCapabilityId.Exporter,
          input: defineJsonSchemaContract({ schema: ExportInputSchema }),
          resultData: defineJsonSchemaContract({ schema: ExportResultDataSchema }),
          export: (request, options) => exportBridge.dispatch(request, options),
        }),
        defineOutputInvokerCapability({
          capabilityId: PythonModelBackendCapabilityId.OutputInvoker,
          input: defineJsonSchemaContract({ schema: InvocationInputSchema }),
          output: defineJsonSchemaContract({ schema: InvocationOutputSchema }),
          invoke: (request, options) => invocationBridge.invoke(request, options),
        }),
      ]),
      runtimeSupports: Object.freeze([
        createLocalArtifactHandoffSupport({
          runtimeSupportId: PythonModelBackendRuntimeSupportId.ArtifactHandoff,
          rootDirectory: extensionOptions.rootDirectory,
        }),
        createLocalExecutionSupport({
          runtimeSupportId: PythonModelBackendRuntimeSupportId.Execution,
          rootDirectory: extensionOptions.rootDirectory,
        }),
      ]),
    }),
  });
}

function createProfile(input: PythonModelBackendProfileInput): ModelProfileInput {
  return Object.freeze({
    profileId: input.profileId,
    ...(input.infrastructure === undefined ? {} : { infrastructure: input.infrastructure }),
    canonicalOutputInvokerId: PythonModelBackendSlotId.OutputInvoker,
    initializers: Object.freeze([
      Object.freeze({
        initializerId: PythonModelBackendSlotId.Initializer,
        capabilityId: PythonModelBackendCapabilityId.Initializer,
        runtimeBindingId: PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
      }),
    ]),
    trainers: Object.freeze([
      Object.freeze({
        trainerId: PythonModelBackendSlotId.Trainer,
        capabilityId: PythonModelBackendCapabilityId.Trainer,
        runtimeBindingId: PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
      }),
    ]),
    exporters: Object.freeze([
      Object.freeze({
        exporterId: PythonModelBackendSlotId.Exporter,
        capabilityId: PythonModelBackendCapabilityId.Exporter,
        runtimeBindingId: PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
      }),
    ]),
    outputInvokers: Object.freeze([
      Object.freeze({
        outputInvokerId: PythonModelBackendSlotId.OutputInvoker,
        capabilityId: PythonModelBackendCapabilityId.OutputInvoker,
        runtimeBindingId: PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID,
      }),
    ]),
  });
}
