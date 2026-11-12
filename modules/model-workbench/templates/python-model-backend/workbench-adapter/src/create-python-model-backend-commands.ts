import { isAbsolute, resolve } from 'node:path';

import type { LocalCommandDefinition } from '@print-an-agent/workbench-local-runtime';

import {
  PYTHON_MODEL_BACKEND_DEVICE_ENVIRONMENT_VARIABLE,
  PYTHON_MODEL_BACKEND_DTYPE_ENVIRONMENT_VARIABLE,
  PYTHON_MODEL_BACKEND_MODULE,
  PYTHON_MODEL_BACKEND_ROOT_ENVIRONMENT_VARIABLE,
  PYTHON_PATH_ENVIRONMENT_VARIABLE,
  PythonModelBackendCommand,
  PythonModelBackendDType,
  PythonModelBackendDevice,
  type PythonModelBackendCommand as PythonModelBackendCommandValue,
} from './constants.js';
import type { PythonModelBackendExtensionOptions } from './contracts.js';

const PYTHON_MODULE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;

export function createPythonModelBackendCommands(
  options: PythonModelBackendExtensionOptions
): Readonly<Record<PythonModelBackendCommandValue, LocalCommandDefinition>> {
  assertAbsolutePath(options.pythonExecutable, 'pythonExecutable');
  assertAbsolutePath(options.rootDirectory, 'rootDirectory');
  assertAbsolutePath(options.backendSourceDirectory, 'backendSourceDirectory');
  const backendModule = options.backendModule ?? PYTHON_MODEL_BACKEND_MODULE;
  if (!PYTHON_MODULE_PATTERN.test(backendModule)) {
    throw new TypeError('backendModule must be a valid dotted Python module name.');
  }
  const backendSourceDirectory = resolve(options.backendSourceDirectory);
  const command = (backendCommand: PythonModelBackendCommandValue): LocalCommandDefinition =>
    Object.freeze({
      executable: options.pythonExecutable,
      arguments: Object.freeze(['-m', backendModule, backendCommand]),
      environment: Object.freeze({
        ...options.environment,
        [PYTHON_PATH_ENVIRONMENT_VARIABLE]: backendSourceDirectory,
        [PYTHON_MODEL_BACKEND_ROOT_ENVIRONMENT_VARIABLE]: resolve(options.rootDirectory),
        [PYTHON_MODEL_BACKEND_DEVICE_ENVIRONMENT_VARIABLE]:
          options.device ?? PythonModelBackendDevice.Cpu,
        [PYTHON_MODEL_BACKEND_DTYPE_ENVIRONMENT_VARIABLE]:
          options.dtype ?? PythonModelBackendDType.Float32,
      }),
      ...(options.inheritEnvironment === undefined
        ? {}
        : { inheritEnvironment: options.inheritEnvironment }),
    });
  return Object.freeze({
    initialize: command(PythonModelBackendCommand.Initialize),
    train: command(PythonModelBackendCommand.Train),
    export: command(PythonModelBackendCommand.Export),
    invoke: command(PythonModelBackendCommand.Invoke),
  });
}

function assertAbsolutePath(value: string, name: string): void {
  if (!isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
}
