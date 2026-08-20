export { createWorkbenchControlPlane } from './composition/create-workbench-control-plane.js';
export { WorkbenchControlPlaneError } from './foundation/errors.js';
export type {
  ModelWorkbenchControlPlane,
  WorkbenchControlPlaneConfiguration,
} from './composition/contracts.js';
export type {
  ProfilePersistence,
  ProfilePersistenceAdapter,
  ProfilePersistenceScope,
} from '@ta-agent/workbench-persistence';

export {
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
  InitializerSlotNotFoundError,
} from './operations/initialization/errors.js';
export { ModelProfileNotFoundError } from './operations/errors.js';
export {
  ExportArtifactVerificationError,
  ExportCapabilityError,
  ExporterSlotNotFoundError,
} from './operations/export/errors.js';
export {
  ModelOutputNotFoundError,
  ModelOutputMismatchError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactMaterializationError,
  OutputInvocationCapabilityError,
  OutputInvokerSlotNotFoundError,
} from './operations/output-invocation/errors.js';
export {
  TrainerSlotNotFoundError,
  TrainingArtifactVerificationError,
  TrainingCapabilityError,
} from './operations/training/errors.js';
export {
  ArtifactHandoffSupportNotFoundError,
  ModelStateArtifactMaterializationError,
  ModelStateAssetMismatchError,
  ModelStateAssetNotFoundError,
  ModelStateAssetProfileMismatchError,
} from './model-states/errors.js';
export {
  ModelRunNotFoundError,
  ModelRunOperationUnavailableError,
  RunCancellationError,
  RunExecutionSupportMismatchError,
  RunObservationError,
} from './execution/errors.js';
export type {
  ExportOperations,
  StartExportInput,
  StartExportResult,
} from './operations/export/contracts.js';
export type {
  InvokeOutputInput,
  OutputInvocationOperations,
} from './operations/output-invocation/contracts.js';
export {
  OutputInvocationKind,
  type CompletedOutputInvocation,
  type OutputInvocation,
  type StreamingOutputInvocation,
} from '@ta-agent/workbench-extension';
export type {
  InitializationOperations,
  StartInitializationInput,
  StartInitializationResult,
} from './operations/initialization/contracts.js';
export type {
  StartTrainingInput,
  StartTrainingResult,
  TrainingOperations,
} from './operations/training/contracts.js';
export type { ModelWorkbenchOperationOptions } from './execution/contracts.js';

export { WorkbenchGeneratedIdKind, type WorkbenchIdSource } from './ports/workbench-id-source.js';
export type {
  ModelAssetQueries,
  BaseReferenceInput,
  ModificationReferenceInput,
  OutputReferenceInput,
  OutputQueries,
  RunReferenceInput,
  RunControls,
  WaitForRunOptions,
} from './queries/contracts.js';
