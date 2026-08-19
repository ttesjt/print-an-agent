export const WorkbenchExtensionFamily = {
  ModelCapability: 'model-capability',
  RuntimeSupport: 'runtime-support',
} as const;

export type WorkbenchExtensionFamily =
  (typeof WorkbenchExtensionFamily)[keyof typeof WorkbenchExtensionFamily];

export const ModelCapabilityKind = {
  Initializer: 'initializer',
  Trainer: 'trainer',
} as const;

export type ModelCapabilityKind = (typeof ModelCapabilityKind)[keyof typeof ModelCapabilityKind];

export const RuntimeSupportKind = {
  ArtifactHandoff: 'artifact-handoff',
  Execution: 'execution',
} as const;

export type RuntimeSupportKind = (typeof RuntimeSupportKind)[keyof typeof RuntimeSupportKind];
