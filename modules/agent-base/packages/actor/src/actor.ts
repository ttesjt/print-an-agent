import { type AgentLoopResult } from '@ta-agent/base-model';
import { parseToolName, type ToolName } from '@ta-agent/base-tool';
import {
  defineActorCapabilityLimits,
  narrowActorCapabilities,
  type ActorCapabilityLimits,
  type ActorEngineCapabilities,
} from './capabilities.js';
import {
  defineActorInvocationConfig,
  type ActorDirectRequest,
  type ActorDirectResult,
  type ActorEngine,
  type ActorInteractionRequest,
  type ActorInvocationConfig,
} from './engine.js';
import { AgentActorError } from './errors.js';
import {
  parseActorEngineId,
  parseActorId,
  type ActorEngineId,
  type ActorId,
} from './identifiers.js';
import { composeActorInstructions, parseActorInstructions } from './instructions.js';
import { createActorInteractionProtocol, normalizeActorDirectResult } from './engine-protocol.js';

export interface ActorDefinitionInput {
  readonly id: string;
  readonly engineId: string;
  readonly instructions?: string;
  readonly invocationConfig?: ActorInvocationConfig;
  readonly capabilityLimits?: ActorCapabilityLimits;
  readonly allowedTools?: readonly string[];
}

export interface ActorDefinition {
  readonly id: ActorId;
  readonly engineId: ActorEngineId;
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly capabilityLimits?: ActorCapabilityLimits;
  readonly allowedTools: readonly ToolName[];
}

export interface ResolvedActor {
  readonly id: ActorId;
  readonly engineId: ActorEngineId;
  readonly catalogRevision: number;
  readonly capabilities: ActorEngineCapabilities;
  readonly allowedTools: readonly ToolName[];
  interact(request: ActorInteractionRequest): Promise<AgentLoopResult>;
  complete(request: ActorDirectRequest): Promise<ActorDirectResult>;
}

const ACTOR_KEYS = Object.freeze([
  'id',
  'engineId',
  'instructions',
  'invocationConfig',
  'capabilityLimits',
  'allowedTools',
]);

function parseAllowedTools(values: readonly string[] | undefined): readonly ToolName[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) {
    throw new AgentActorError('ACTOR_DEFINITION_INVALID', 'Actor allowedTools must be an array.');
  }
  let parsed: readonly ToolName[];
  try {
    parsed = values.map(parseToolName);
  } catch (cause: unknown) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor allowedTools contains an invalid Tool name.',
      { cause }
    );
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor allowedTools contains duplicates.'
    );
  }
  return Object.freeze(parsed);
}

export function defineActor(input: ActorDefinitionInput): ActorDefinition {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError('ACTOR_DEFINITION_INVALID', 'Actor definition must be an object.');
  }
  const unexpected = Object.keys(input).find((key) => !ACTOR_KEYS.includes(key));
  if (unexpected !== undefined) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      `Actor definition contains unsupported field "${unexpected}".`
    );
  }
  const instructions = parseActorInstructions(input.instructions, 'Actor instructions');
  const capabilityLimits =
    input.capabilityLimits === undefined
      ? undefined
      : defineActorCapabilityLimits(input.capabilityLimits);
  return Object.freeze({
    id: parseActorId(input.id),
    engineId: parseActorEngineId(input.engineId),
    ...(instructions === undefined ? {} : { instructions }),
    invocationConfig: defineActorInvocationConfig(input.invocationConfig),
    ...(capabilityLimits === undefined ? {} : { capabilityLimits }),
    allowedTools: parseAllowedTools(input.allowedTools),
  });
}

export function resolveActor(
  definition: ActorDefinition,
  engine: ActorEngine,
  catalogRevision: number
): ResolvedActor {
  if (definition.engineId !== engine.id) {
    throw new AgentActorError(
      'ACTOR_ENGINE_NOT_FOUND',
      `Actor "${definition.id}" references unavailable Engine "${definition.engineId}".`
    );
  }
  const capabilities = narrowActorCapabilities(engine.capabilities, definition.capabilityLimits);
  return Object.freeze({
    id: definition.id,
    engineId: definition.engineId,
    catalogRevision,
    capabilities,
    allowedTools: definition.allowedTools,
    async interact(request: ActorInteractionRequest): Promise<AgentLoopResult> {
      if (!capabilities.invocationModes.includes('interaction') || engine.interact === undefined) {
        throw new AgentActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support interaction invocation.`
        );
      }
      if (request.tools.tools.length > 0 && !capabilities.toolCalling) {
        throw new AgentActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support Tool calls.`
        );
      }
      const protocol = createActorInteractionProtocol(request.emit, request.maxModelTurns);
      let result: unknown;
      try {
        result = await engine.interact({
          ...request,
          instructions: composeActorInstructions(definition.instructions, request.instructions),
          invocationConfig: definition.invocationConfig,
          emit: protocol.emit,
        });
      } catch (cause: unknown) {
        protocol.assertValid();
        throw cause;
      }
      return protocol.complete(result);
    },
    async complete(request: ActorDirectRequest): Promise<ActorDirectResult> {
      if (!capabilities.invocationModes.includes('direct') || engine.complete === undefined) {
        throw new AgentActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support direct invocation.`
        );
      }
      const result = await engine.complete({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
        invocationConfig: definition.invocationConfig,
      });
      return normalizeActorDirectResult(result);
    },
  });
}
