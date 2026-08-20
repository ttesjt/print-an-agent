import type { OutputId, OutputInvokerId, ProfileId } from '@ta-agent/workbench-domain';

import { WorkbenchControlPlaneError } from '../../foundation/errors.js';

export class ModelOutputNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_OUTPUT_NOT_FOUND';

  constructor(outputId: OutputId) {
    super(ModelOutputNotFoundError.code, `Model Output "${outputId}" was not found.`);
    this.name = 'ModelOutputNotFoundError';
  }
}

export class ModelOutputMismatchError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_OUTPUT_MISMATCH';

  constructor(expectedOutputId: OutputId, observedOutputId: OutputId) {
    super(
      ModelOutputMismatchError.code,
      `Output Repository returned "${observedOutputId}" for requested Output "${expectedOutputId}".`
    );
    this.name = 'ModelOutputMismatchError';
  }
}

export class ModelOutputProfileMismatchError extends WorkbenchControlPlaneError {
  static readonly code = 'MODEL_OUTPUT_PROFILE_MISMATCH';

  constructor(outputId: OutputId, expectedProfileId: ProfileId, observedProfileId: ProfileId) {
    super(
      ModelOutputProfileMismatchError.code,
      `Output "${outputId}" belongs to Profile "${observedProfileId}", not requested Profile "${expectedProfileId}".`
    );
    this.name = 'ModelOutputProfileMismatchError';
  }
}

export class OutputInvokerSlotNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'OUTPUT_INVOKER_SLOT_NOT_FOUND';

  constructor(profileId: string, outputInvokerId: OutputInvokerId) {
    super(
      OutputInvokerSlotNotFoundError.code,
      `Profile "${profileId}" does not define Output Invoker "${outputInvokerId}".`
    );
    this.name = 'OutputInvokerSlotNotFoundError';
  }
}

export class OutputInvocationArtifactMaterializationError extends WorkbenchControlPlaneError {
  static readonly code = 'OUTPUT_INVOCATION_ARTIFACT_MATERIALIZATION_FAILED';

  constructor(outputId: OutputId, artifactId: string, options?: ErrorOptions) {
    super(
      OutputInvocationArtifactMaterializationError.code,
      `Artifact "${artifactId}" for Output "${outputId}" could not be materialized for invocation.`,
      options
    );
    this.name = 'OutputInvocationArtifactMaterializationError';
  }
}

export class OutputInvocationCapabilityError extends WorkbenchControlPlaneError {
  static readonly code = 'OUTPUT_INVOCATION_CAPABILITY_FAILED';

  constructor(profileId: string, outputId: string, options?: ErrorOptions) {
    super(
      OutputInvocationCapabilityError.code,
      `Output Invoker Capability failed for Output "${outputId}" in Profile "${profileId}".`,
      options
    );
    this.name = 'OutputInvocationCapabilityError';
  }
}
