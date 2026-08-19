import type { RunId } from '@ta-agent/workbench-domain';

import { WorkbenchControlPlaneError } from '../../foundation/errors.js';

export class TrainingSourceAssetNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'TRAINING_SOURCE_ASSET_NOT_FOUND';

  constructor(runId: RunId, assetKind: 'base' | 'modification', assetId: string) {
    super(
      TrainingSourceAssetNotFoundError.code,
      `Training Run "${runId}" references unknown ${assetKind} "${assetId}".`
    );
    this.name = 'TrainingSourceAssetNotFoundError';
  }
}

export class ArtifactHandoffSupportNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'ARTIFACT_HANDOFF_SUPPORT_NOT_FOUND';

  constructor(runId: RunId, runtimeSupportId: string) {
    super(
      ArtifactHandoffSupportNotFoundError.code,
      `Training Run "${runId}" cannot resolve Artifact Handoff Support "${runtimeSupportId}".`
    );
    this.name = 'ArtifactHandoffSupportNotFoundError';
  }
}

export class TrainingSourceAssetMismatchError extends WorkbenchControlPlaneError {
  static readonly code = 'TRAINING_SOURCE_ASSET_MISMATCH';

  constructor(
    runId: RunId,
    assetKind: 'base' | 'modification',
    expectedId: string,
    observedId: string
  ) {
    super(
      TrainingSourceAssetMismatchError.code,
      `Training Run "${runId}" requested ${assetKind} "${expectedId}" but persistence returned "${observedId}".`
    );
    this.name = 'TrainingSourceAssetMismatchError';
  }
}

export class TrainingSourcePreparationError extends WorkbenchControlPlaneError {
  static readonly code = 'TRAINING_SOURCE_PREPARATION_FAILED';

  constructor(runId: RunId, artifactId: string, options?: ErrorOptions) {
    super(
      TrainingSourcePreparationError.code,
      `Artifact "${artifactId}" for Training Run "${runId}" could not be prepared.`,
      options
    );
  }
}

export class TrainerSlotNotFoundError extends WorkbenchControlPlaneError {
  constructor(profileId: string, trainerId: string) {
    super(
      'TRAINER_SLOT_NOT_FOUND',
      `Trainer "${trainerId}" is not defined by Model Profile "${profileId}".`
    );
  }
}

export class TrainingCapabilityError extends WorkbenchControlPlaneError {
  constructor(runId: RunId, options?: ErrorOptions) {
    super(
      'TRAINING_CAPABILITY_ERROR',
      `Trainer Capability for Run "${runId}" did not produce an acceptable terminal result.`,
      options
    );
  }
}

export class TrainingArtifactVerificationError extends WorkbenchControlPlaneError {
  constructor(runId: RunId, artifactId: string, options?: ErrorOptions) {
    super(
      'TRAINING_ARTIFACT_VERIFICATION_ERROR',
      `Artifact "${artifactId}" produced by Training Run "${runId}" could not be verified.`,
      options
    );
  }
}
