import {
  defineActor as defineModelActor,
  type ActorDefinition as ModelActorDefinition,
  type ActorDefinitionInput as ModelActorDefinitionInput,
  type ResolvedActor as ResolvedModelActor,
} from '@ta-agent/model-invocation-core';
import { parseToolName, type ToolName } from '@ta-agent/base-tool';
import { AgentActorError } from './errors.js';

export interface ActorDefinitionInput extends ModelActorDefinitionInput {
  readonly allowedTools?: readonly string[];
}
export interface ActorDefinition extends ModelActorDefinition {
  readonly allowedTools: readonly ToolName[];
}
export interface ResolvedActor extends ResolvedModelActor {
  readonly catalogRevision: number;
  readonly allowedTools: readonly ToolName[];
}

/** Agent-owned permission policy layered over the independent Actor definition. */
export function defineAgentActor(input: ActorDefinitionInput): ActorDefinition {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Agent Actor definition must be an object.'
    );
  }
  const { allowedTools, ...modelInput } = input;
  const definition = defineModelActor(modelInput);
  if (allowedTools !== undefined && !Array.isArray(allowedTools)) {
    throw new AgentActorError('ACTOR_DEFINITION_INVALID', 'Actor allowedTools must be an array.');
  }
  try {
    const parsed = (allowedTools ?? []).map(parseToolName);
    if (new Set(parsed).size !== parsed.length) {
      throw new AgentActorError(
        'ACTOR_DEFINITION_INVALID',
        'Actor allowedTools contains duplicates.'
      );
    }
    return Object.freeze({ ...definition, allowedTools: Object.freeze(parsed) });
  } catch (cause) {
    if (cause instanceof AgentActorError) throw cause;
    throw new AgentActorError('ACTOR_DEFINITION_INVALID', 'Actor contains an invalid Tool name.', {
      cause,
    });
  }
}
