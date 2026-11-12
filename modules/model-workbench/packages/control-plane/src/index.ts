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
} from '@print-an-agent/workbench-persistence';

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
  CanonicalOutputInvokerAmbiguousError,
  CanonicalOutputInvokerUnavailableError,
  ModelOutputNotFoundError,
  ModelOutputMismatchError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactMaterializationError,
  OutputInvocationArtifactSupportNotFoundError,
  OutputInvocationArtifactVerificationError,
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
  CompletedOutputInvocation,
  InvokeOutputInput,
  OutputInvocation,
  OutputInvocationTargetEvidence,
  OutputInvocationOperations,
  ResolveOutputInvocationInput,
  StreamingOutputInvocation,
} from './operations/output-invocation/contracts.js';
export { OutputInvocationTargetEvidenceKind } from './operations/output-invocation/contracts.js';
export { OutputInvocationKind } from '@print-an-agent/workbench-extension';
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
export type { WorkbenchClock } from './ports/workbench-clock.js';
export type {
  ModelAssetQueries,
  BaseReferenceInput,
  DiscoveryPageInput,
  ListModelAssetsInput,
  ListOutputsInput,
  ListRunsInput,
  ModificationReferenceInput,
  OutputReferenceInput,
  OutputQueries,
  RunReferenceInput,
  RunControls,
  RecordPage,
  WaitForRunOptions,
} from './queries/contracts.js';
