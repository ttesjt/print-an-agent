export const WorkbenchExtensionFamily = {
  ModelCapability: 'model-capability',
  RuntimeSupport: 'runtime-support',
} as const;

export type WorkbenchExtensionFamily =
  (typeof WorkbenchExtensionFamily)[keyof typeof WorkbenchExtensionFamily];

export const ModelCapabilityKind = {
  Initializer: 'initializer',
} as const;

export type ModelCapabilityKind = (typeof ModelCapabilityKind)[keyof typeof ModelCapabilityKind];

export const RuntimeSupportKind = {
  ArtifactVerifier: 'artifact-verifier',
} as const;

export type RuntimeSupportKind = (typeof RuntimeSupportKind)[keyof typeof RuntimeSupportKind];

export const CapabilityOutcomeStatus = {
  Succeeded: 'succeeded',
  Failed: 'failed',
} as const;

export type CapabilityOutcomeStatus =
  (typeof CapabilityOutcomeStatus)[keyof typeof CapabilityOutcomeStatus];
