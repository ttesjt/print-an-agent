export const PythonModelBackendCapabilityId = {
  Initializer: 'python-model-backend.initialize',
  Trainer: 'python-model-backend.train',
  Exporter: 'python-model-backend.export',
  OutputInvoker: 'python-model-backend.invoke',
} as const;

export const PythonModelBackendSlotId = {
  Initializer: 'initialize',
  Trainer: 'train',
  Exporter: 'export',
  OutputInvoker: 'invoke',
} as const;

export const PythonModelBackendRuntimeSupportId = {
  ArtifactHandoff: 'python-model-backend.artifacts.local',
  Execution: 'python-model-backend.execution.local',
} as const;

export const PYTHON_MODEL_BACKEND_RUNTIME_BINDING_ID = 'python-model-backend.runtime.local';
export const PYTHON_MODEL_BACKEND_ROOT_ENVIRONMENT_VARIABLE =
  'TA_AGENT_MODEL_BACKEND_ROOT_DIRECTORY';
export const PYTHON_MODEL_BACKEND_DEVICE_ENVIRONMENT_VARIABLE = 'TA_AGENT_MODEL_BACKEND_DEVICE';
export const PYTHON_MODEL_BACKEND_DTYPE_ENVIRONMENT_VARIABLE = 'TA_AGENT_MODEL_BACKEND_DTYPE';
export const PYTHON_PATH_ENVIRONMENT_VARIABLE = 'PYTHONPATH';
export const PYTHON_MODEL_BACKEND_MODULE = 'ta_agent_model_backend';

export const PythonModelBackendDevice = {
  Cpu: 'cpu',
  Cuda: 'cuda',
  Mps: 'mps',
} as const;

export type PythonModelBackendDevice =
  (typeof PythonModelBackendDevice)[keyof typeof PythonModelBackendDevice];

export const PythonModelBackendDType = {
  Float16: 'float16',
  Float32: 'float32',
  BFloat16: 'bfloat16',
} as const;

export type PythonModelBackendDType =
  (typeof PythonModelBackendDType)[keyof typeof PythonModelBackendDType];

export const PythonModelBackendCommand = {
  Initialize: 'initialize',
  Train: 'train',
  Export: 'export',
  Invoke: 'invoke',
} as const;

export type PythonModelBackendCommand =
  (typeof PythonModelBackendCommand)[keyof typeof PythonModelBackendCommand];
