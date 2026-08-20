import type { RunId } from '@ta-agent/workbench-domain';

import { WorkbenchControlPlaneError } from '../../foundation/errors.js';

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
