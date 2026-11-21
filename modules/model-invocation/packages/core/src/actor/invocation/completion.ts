import { ActorError } from '../errors.js';
import type { ActorEngineCapabilities } from '../capabilities/index.js';
import type {
  ActorInvocationBinding,
  ActorDirectRequest,
  ActorDirectResult,
  ActorEngineHandlers,
} from '../types/invocation.js';
import { runActorInvocation } from './deadline.js';
import { composeActorInstructions } from '../instructions.js';
import { ModelInvocationError } from '../../model/index.js';
import { normalizeActorDirectResult } from './result-protocol.js';

export async function invokeActorCompletion(
  definition: ActorInvocationBinding,
  capabilities: ActorEngineCapabilities,
  handlers: Pick<ActorEngineHandlers, 'complete'>,
  request: ActorDirectRequest
): Promise<ActorDirectResult> {
  if (!Number.isSafeInteger(request.maxOutputCharacters) || request.maxOutputCharacters < 1) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Completion output budget must be a positive safe integer.'
    );
  }

  const complete = handlers.complete;
  if (!capabilities.invocationModes.includes('direct') || complete === undefined) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${definition.id}" does not support direct invocation.`
    );
  }
  return runActorInvocation(
    {
      actorId: definition.id,
      invocationKind: 'complete',
      parentSignal: request.signal,
      policy: definition.invocationPolicy,
    },
    async (signal) => {
      const result = await complete({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
        invocationConfig: definition.invocationConfig,
        signal,
      });
      return normalizeActorDirectResult(result, request.maxOutputCharacters);
    }
  );
}
