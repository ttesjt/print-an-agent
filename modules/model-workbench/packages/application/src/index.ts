export { createModelWorkbench } from './composition/create-model-workbench.js';
export type { ModelWorkbenchApplicationConfiguration } from './composition/contracts.js';

export {
  InitializationArtifactMismatchError,
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
  InitializerSlotNotFoundError,
  ModelProfileNotFoundError,
  WorkbenchControlPlaneError,
  WorkbenchGeneratedIdKind,
} from '@ta-agent/workbench-control-plane';
export type {
  ModelAssetQueries,
  ModelWorkbenchControlPlane as ModelWorkbench,
  ModelWorkbenchOperationOptions,
  RunQueries,
  StartInitializationInput,
  StartInitializationResult,
  WorkbenchIdSource,
} from '@ta-agent/workbench-control-plane';
