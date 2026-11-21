export { ACTOR_INVOCATION_MODES, ACTOR_INPUT_MEDIA_TYPES } from './options.js';
export type { ActorInvocationMode, ActorInputMediaType } from './options.js';
export type {
  ActorInteractionCapabilities,
  ActorEngineCapabilitiesInput,
  ActorEngineCapabilities,
  ActorInteractionCapabilityLimits,
  ActorCapabilityLimits,
  ActorInteractionCapabilityRequirements,
  ActorCapabilityRequirements,
} from './types.js';
export { defineActorEngineCapabilities } from './engine-capabilities.js';
export { defineActorCapabilityLimits } from './limits.js';
export { narrowActorCapabilities } from './narrowing.js';
export { validateActorCapabilityRequirements, satisfiesActorRequirements } from './requirements.js';
export type {
  ActorCapabilityRequirementsIssue,
  ActorCapabilityRequirementsValidation,
} from './requirements.js';
