import type { ModelOperationKind, ProfileId, RunId } from '@print-an-agent/workbench-domain';

import { WorkbenchControlPlaneError } from '../foundation/errors.js';

export class ModelStateAssetNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_STATE_ASSET_NOT_FOUND';

  constructor(
    runId: RunId,
    operation: ModelOperationKind,
    assetKind: 'base' | 'modification',
    assetId: string
  ) {
    super(
      ModelStateAssetNotFoundError.code,
      `${operation} Run "${runId}" references unknown ${assetKind} "${assetId}".`
    );
    this.name = 'ModelStateAssetNotFoundError';
  }
}

export class ArtifactHandoffSupportNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'ARTIFACT_HANDOFF_SUPPORT_NOT_FOUND';

  constructor(runId: RunId, operation: ModelOperationKind, runtimeSupportId: string) {
    super(
      ArtifactHandoffSupportNotFoundError.code,
      `${operation} Run "${runId}" cannot resolve Artifact Handoff Support "${runtimeSupportId}".`
    );
    this.name = 'ArtifactHandoffSupportNotFoundError';
  }
}

export class ModelStateAssetMismatchError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_STATE_ASSET_MISMATCH';

  constructor(
    runId: RunId,
    operation: ModelOperationKind,
    assetKind: 'base' | 'modification',
    expectedId: string,
    observedId: string
  ) {
    super(
      ModelStateAssetMismatchError.code,
      `${operation} Run "${runId}" requested ${assetKind} "${expectedId}" but persistence returned "${observedId}".`
    );
    this.name = 'ModelStateAssetMismatchError';
  }
}

export class ModelStateArtifactMaterializationError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_STATE_ARTIFACT_MATERIALIZATION_FAILED';

  constructor(
    runId: RunId,
    operation: ModelOperationKind,
    artifactId: string,
    options?: ErrorOptions
  ) {
    super(
      ModelStateArtifactMaterializationError.code,
      `Artifact "${artifactId}" for ${operation} Run "${runId}" could not be materialized.`,
      options
    );
    this.name = 'ModelStateArtifactMaterializationError';
  }
}

export class ModelStateAssetProfileMismatchError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_STATE_ASSET_PROFILE_MISMATCH';

  constructor(
    runId: RunId,
    operation: ModelOperationKind,
    assetKind: 'base' | 'modification',
    assetId: string,
    expectedProfileId: ProfileId,
    observedProfileId: ProfileId
  ) {
    super(
      ModelStateAssetProfileMismatchError.code,
      `${operation} Run "${runId}" requested ${assetKind} "${assetId}" in Profile "${expectedProfileId}" but persistence returned Profile "${observedProfileId}".`
    );
    this.name = 'ModelStateAssetProfileMismatchError';
  }
}
