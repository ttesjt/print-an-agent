import { WorkbenchControlPlaneError } from '../../foundation/errors.js';

export class ModelProfileNotFoundError extends WorkbenchControlPlaneError {
  readonly profileId: string;

  constructor(profileId: string) {
    super('MODEL_PROFILE_NOT_FOUND', `Model Profile "${profileId}" is not defined.`);
    this.profileId = profileId;
  }
}

export class InitializerSlotNotFoundError extends WorkbenchControlPlaneError {
  readonly profileId: string;
  readonly initializerId: string;

  constructor(profileId: string, initializerId: string) {
    super(
      'INITIALIZER_SLOT_NOT_FOUND',
      `Initializer "${initializerId}" is not defined by Model Profile "${profileId}".`
    );
    this.profileId = profileId;
    this.initializerId = initializerId;
  }
}

export class InitializationCapabilityError extends WorkbenchControlPlaneError {
  readonly runId: string;

  constructor(runId: string, options?: ErrorOptions) {
    super(
      'INITIALIZATION_CAPABILITY_ERROR',
      `Initializer Capability for Run "${runId}" did not produce an acceptable terminal result.`,
      options
    );
    this.runId = runId;
  }
}

export class InitializationArtifactVerificationError extends WorkbenchControlPlaneError {
  readonly runId: string;
  readonly artifactId: string;

  constructor(runId: string, artifactId: string, options?: ErrorOptions) {
    super(
      'INITIALIZATION_ARTIFACT_VERIFICATION_ERROR',
      `Artifact "${artifactId}" produced by Initialization Run "${runId}" could not be verified.`,
      options
    );
    this.runId = runId;
    this.artifactId = artifactId;
  }
}
