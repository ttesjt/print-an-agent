import type { ActorId, ActorCapabilityRequirements } from '@print-an-agent/model-invocation-core';
import type { ToolName } from '@print-an-agent/base-tool';

declare const responsibilityIdBrand: unique symbol;
export type ResponsibilityId = string & { readonly [responsibilityIdBrand]: 'ResponsibilityId' };

export interface ResponsibilityActorCandidateInput {
  readonly actorId: string;
  readonly enabled: boolean;
}

export interface ResponsibilityActorCandidate {
  readonly actorId: ActorId;
  readonly enabled: boolean;
}

export interface ResponsibilityDefinitionInput {
  readonly id: string;
  readonly actors?: readonly ResponsibilityActorCandidateInput[];
  readonly instructions?: string;
  readonly requiredCapabilities: ActorCapabilityRequirements;
  readonly allowedTools?: readonly string[];
}

export interface ResponsibilityDefinition {
  readonly id: ResponsibilityId;
  readonly actors?: readonly ResponsibilityActorCandidate[];
  readonly instructions?: string;
  readonly requiredCapabilities: ActorCapabilityRequirements;
  readonly allowedTools: readonly ToolName[];
}
