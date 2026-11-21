import type { ActorInvocationMode, ActorInputMediaType } from './options.js';

export interface ActorInteractionCapabilities {
  readonly streamable: boolean;
}

export interface ActorEngineCapabilitiesInput {
  readonly invocationModes: readonly ActorInvocationMode[];
  readonly inputMediaTypes: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilities;
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly cancellation: boolean;
  readonly maxContextTokens?: number;
}

export type ActorEngineCapabilities = ActorEngineCapabilitiesInput;

export interface ActorInteractionCapabilityLimits {
  readonly streamable?: boolean;
}

export interface ActorCapabilityLimits {
  readonly invocationModes?: readonly ActorInvocationMode[];
  readonly inputMediaTypes?: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilityLimits;
  readonly toolCalling?: boolean;
  readonly structuredOutput?: boolean;
  readonly cancellation?: boolean;
  readonly maxContextTokens?: number;
}

export interface ActorInteractionCapabilityRequirements {
  readonly streamable: true;
}

export interface ActorCapabilityRequirements {
  readonly invocationMode: ActorInvocationMode;
  readonly inputMediaTypes?: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilityRequirements;
  readonly toolCalling?: true;
  readonly structuredOutput?: true;
  readonly cancellation?: true;
  readonly minimumContextTokens?: number;
}
