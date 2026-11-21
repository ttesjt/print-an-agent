import { ActorError } from '../errors.js';
import type { ActorEngineCapabilities } from '../capabilities/index.js';
import type {
  ActorInvocationBinding,
  ActorInteractionRequest,
  ActorEngineHandlers,
} from '../types/invocation.js';
import { runActorInvocation } from './deadline.js';
import { composeActorInstructions } from '../instructions.js';
import type { ModelInteractionResult } from '../../model/index.js';
import { bindInteractionTools } from './interaction-tools.js';
import { createActorInteractionProtocol } from './interaction-protocol.js';

export async function invokeActorInteraction(
  definition: ActorInvocationBinding,
  capabilities: ActorEngineCapabilities,
  handlers: Pick<ActorEngineHandlers, 'interact'>,
  request: ActorInteractionRequest
): Promise<ModelInteractionResult> {
  const interact = handlers.interact;
  if (!capabilities.invocationModes.includes('interaction') || interact === undefined) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${definition.id}" does not support interaction invocation.`
    );
  }
  if (request.tools.tools.length > 0 && !capabilities.toolCalling) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${definition.id}" does not support Tool calls.`
    );
  }
  return runActorInvocation(
    {
      actorId: definition.id,
      invocationKind: 'interact',
      parentSignal: request.signal,
      policy: definition.invocationPolicy,
    },
    async (signal, assertWithinDeadline) => {
      const protocol = createActorInteractionProtocol((event) => {
        assertWithinDeadline();
        return request.emit(event);
      }, request.maxModelTurns);
      let result: unknown;
      try {
        result = await interact({
          ...request,
          tools: bindInteractionTools(request.tools, signal),
          instructions: composeActorInstructions(definition.instructions, request.instructions),
          invocationConfig: definition.invocationConfig,
          signal,
          emit: protocol.emit,
        });
      } catch (cause: unknown) {
        protocol.assertValid();
        throw cause;
      } finally {
        protocol.close();
      }
      return protocol.complete(result);
    }
  );
}
