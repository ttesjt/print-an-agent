import type {
  ArtifactId,
  OutputId,
  OutputInvokerId,
  ProfileId,
  RuntimeSupportId,
} from '@ta-agent/workbench-domain';

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

export class CanonicalOutputInvokerUnavailableError extends WorkbenchControlPlaneError {
  static readonly code = 'CANONICAL_OUTPUT_INVOKER_UNAVAILABLE';

  constructor(profileId: ProfileId) {
    super(
      CanonicalOutputInvokerUnavailableError.code,
      `Profile "${profileId}" does not define an Output Invoker that can be selected canonically.`
    );
  }
}

export class CanonicalOutputInvokerAmbiguousError extends WorkbenchControlPlaneError {
  static readonly code = 'CANONICAL_OUTPUT_INVOKER_AMBIGUOUS';

  constructor(profileId: ProfileId) {
    super(
      CanonicalOutputInvokerAmbiguousError.code,
      `Profile "${profileId}" defines multiple Output Invokers without a canonical selection.`
    );
  }
}

export class OutputInvocationArtifactSupportNotFoundError extends WorkbenchControlPlaneError {
  static readonly code = 'OUTPUT_INVOCATION_ARTIFACT_SUPPORT_NOT_FOUND';

  constructor(outputId: OutputId, artifactId: ArtifactId, runtimeSupportId: RuntimeSupportId) {
    super(
      OutputInvocationArtifactSupportNotFoundError.code,
      `Artifact "${artifactId}" for Output "${outputId}" references unavailable Artifact Handoff Support "${runtimeSupportId}".`
    );
  }
}

export class OutputInvocationArtifactVerificationError extends WorkbenchControlPlaneError {
  static readonly code = 'OUTPUT_INVOCATION_ARTIFACT_VERIFICATION_FAILED';

  constructor(outputId: OutputId, artifactId: ArtifactId, options?: ErrorOptions) {
    super(
      OutputInvocationArtifactVerificationError.code,
      `Artifact "${artifactId}" for Output "${outputId}" could not be verified for invocation.`,
      options
    );
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
