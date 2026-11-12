import { WorkbenchControlPlaneError } from '@print-an-agent/workbench-control-plane';
import { WorkbenchDomainError } from '@print-an-agent/workbench-domain';
import { WorkbenchExtensionError } from '@print-an-agent/workbench-extension';
import { WorkbenchPersistenceError } from '@print-an-agent/workbench-persistence';
import { WorkbenchSetupError } from '@print-an-agent/workbench-setup';

export const ModelWorkbenchErrorCategory = {
  InvalidRequestOrConfiguration: 'invalid-request-or-configuration',
  TargetNotCallable: 'target-not-callable',
  OperationFailure: 'operation-failure',
  InvocationFailure: 'invocation-failure',
  Cancellation: 'cancellation',
  PersistenceOrIntegrityFailure: 'persistence-or-integrity-failure',
  UnexpectedFailure: 'unexpected-failure',
} as const;

export type ModelWorkbenchErrorCategory =
  (typeof ModelWorkbenchErrorCategory)[keyof typeof ModelWorkbenchErrorCategory];

export interface ModelWorkbenchErrorClassification {
  readonly category: ModelWorkbenchErrorCategory;
  /** Concrete Workbench error code, when the classified error exposes one. */
  readonly code?: string;
}

const ControlPlaneCategoryByCode: Readonly<Record<string, ModelWorkbenchErrorCategory>> =
  Object.freeze({
    DISCOVERY_FILTER_INVALID: ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration,
    DISCOVERY_PAGE_INVALID: ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration,

    ARTIFACT_HANDOFF_SUPPORT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    CANONICAL_OUTPUT_INVOKER_AMBIGUOUS: ModelWorkbenchErrorCategory.TargetNotCallable,
    CANONICAL_OUTPUT_INVOKER_UNAVAILABLE: ModelWorkbenchErrorCategory.TargetNotCallable,
    EXPORTER_SLOT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    INITIALIZER_SLOT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    MODEL_OUTPUT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    MODEL_PROFILE_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    MODEL_RUN_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    MODEL_RUN_OPERATION_UNAVAILABLE: ModelWorkbenchErrorCategory.TargetNotCallable,
    MODEL_STATE_ASSET_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    OUTPUT_INVOCATION_ARTIFACT_SUPPORT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    OUTPUT_INVOCATION_ARTIFACT_VERIFICATION_FAILED: ModelWorkbenchErrorCategory.TargetNotCallable,
    OUTPUT_INVOKER_SLOT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,
    TRAINER_SLOT_NOT_FOUND: ModelWorkbenchErrorCategory.TargetNotCallable,

    EXPORT_ARTIFACT_VERIFICATION_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    EXPORT_CAPABILITY_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    INITIALIZATION_ARTIFACT_VERIFICATION_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    INITIALIZATION_CAPABILITY_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    MODEL_STATE_ARTIFACT_MATERIALIZATION_FAILED: ModelWorkbenchErrorCategory.OperationFailure,
    RUN_CANCELLATION_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    RUN_OBSERVATION_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    TRAINING_ARTIFACT_VERIFICATION_ERROR: ModelWorkbenchErrorCategory.OperationFailure,
    TRAINING_CAPABILITY_ERROR: ModelWorkbenchErrorCategory.OperationFailure,

    OUTPUT_INVOCATION_ARTIFACT_MATERIALIZATION_FAILED:
      ModelWorkbenchErrorCategory.InvocationFailure,
    OUTPUT_INVOCATION_CAPABILITY_FAILED: ModelWorkbenchErrorCategory.InvocationFailure,

    DISCOVERY_PERSISTENCE_INVALID: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    DISCOVERY_RECORD_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    MODEL_OUTPUT_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    MODEL_OUTPUT_PROFILE_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    MODEL_STATE_ASSET_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    MODEL_STATE_ASSET_PROFILE_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    RUN_EXECUTION_SUPPORT_MISMATCH: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
  });

/**
 * Classifies errors at the public application boundary without hiding their concrete type or cause.
 * Unknown errors intentionally remain unexpected rather than being inferred from their message.
 */
export function classifyModelWorkbenchError(error: unknown): ModelWorkbenchErrorClassification {
  if (isAbortError(error)) {
    return defineClassification(ModelWorkbenchErrorCategory.Cancellation, error);
  }
  if (
    error instanceof WorkbenchSetupError ||
    error instanceof WorkbenchDomainError ||
    error instanceof WorkbenchExtensionError
  ) {
    return defineClassification(ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration, error);
  }
  if (error instanceof WorkbenchPersistenceError) {
    return defineClassification(ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure, error);
  }
  if (error instanceof WorkbenchControlPlaneError) {
    const category = ControlPlaneCategoryByCode[error.code];
    return defineClassification(category ?? ModelWorkbenchErrorCategory.UnexpectedFailure, error);
  }
  return Object.freeze({ category: ModelWorkbenchErrorCategory.UnexpectedFailure });
}

function defineClassification(
  category: ModelWorkbenchErrorCategory,
  error: unknown
): ModelWorkbenchErrorClassification {
  const code = readErrorCode(error);
  return Object.freeze({ category, ...(code === undefined ? {} : { code }) });
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
