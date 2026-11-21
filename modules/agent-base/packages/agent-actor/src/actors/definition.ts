import { defineActor as defineModelActor } from '@print-an-agent/model-invocation-core';
import { parseToolName } from '@print-an-agent/base-tool';
import { AgentActorError } from '../errors.js';
import type { AgentActorDefinition, AgentActorDefinitionInput } from './types/definition.js';

/** Agent-owned permission policy layered over the independent Actor definition. */
export function defineAgentActor(input: AgentActorDefinitionInput): AgentActorDefinition {
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
