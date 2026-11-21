import {
  requireCompletionCapability,
  requireInteractionCapability,
  requireStreamingCapability,
  satisfiesActorRequirements,
  composeActorInstructions,
  type ActorDirectRequest,
  type ActorInteractionRequest,
  type ActorStreamingRequest,
} from '@print-an-agent/model-invocation-core';
import type { ResolvedAgentActor } from '../actors/index.js';
import { AgentActorError } from '../errors.js';
import type { ResponsibilityDefinition, ResponsibilityActorCandidate } from './types/definition.js';
import type { ResolvedResponsibility } from './types/routing.js';

export function resolveResponsibility(
  definition: ResponsibilityDefinition,
  catalogRevision: number,
  actor: ResolvedAgentActor,
  candidateIndex: number,
  effectiveCandidates: readonly ResponsibilityActorCandidate[]
): ResolvedResponsibility {
  if (!satisfiesActorRequirements(actor.capabilities, definition.requiredCapabilities)) {
    throw new AgentActorError(
      'RESPONSIBILITY_CAPABILITY_UNAVAILABLE',
      `Actor "${actor.id}" does not satisfy Responsibility "${definition.id}".`
    );
  }
  return Object.freeze({
    id: definition.id,
    catalogRevision,
    actor,
    candidateIndex,
    allowedTools: definition.allowedTools,
    effectiveCandidates,
    interact: (request: ActorInteractionRequest) =>
      requireInteractionCapability(actor).interact({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
      }),
    complete: (request: ActorDirectRequest) =>
      requireCompletionCapability(actor).complete({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
      }),
    ...(actor.stream === undefined
      ? {}
      : {
          stream: (request: ActorStreamingRequest) =>
            requireStreamingCapability(actor).stream({
              ...request,
              instructions: composeActorInstructions(definition.instructions, request.instructions),
            }),
        }),
  });
}
