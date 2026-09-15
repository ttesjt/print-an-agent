import type {
  ModelProfileInput,
  WorkbenchExtensionResources,
  WorkbenchSetupInput,
} from '@ta-agent/workbench-setup';

import type { PythonModelBackendDType, PythonModelBackendDevice } from './constants.js';

export interface PythonModelBackendExtensionOptions {
  readonly pythonExecutable: string;
  readonly backendModule?: string;
  readonly backendSourceDirectory: string;
  readonly rootDirectory: string;
  readonly device?: PythonModelBackendDevice;
  readonly dtype?: PythonModelBackendDType;
  readonly environment?: Readonly<Record<string, string>>;
  readonly inheritEnvironment?: boolean;
}

export interface PythonModelBackendProfileInput {
  readonly profileId: string;
  readonly infrastructure?: ModelProfileInput['infrastructure'];
}

export interface PythonModelBackendSetupInput {
  readonly profiles: readonly PythonModelBackendProfileInput[];
}

export interface PythonModelBackendDefinition {
  readonly setup: WorkbenchSetupInput;
  readonly extensions: WorkbenchExtensionResources;
}
