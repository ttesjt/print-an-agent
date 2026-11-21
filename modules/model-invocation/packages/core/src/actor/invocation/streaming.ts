import type { ActorInvocationBinding } from '../types/invocation.js';
import type {
  ActorDirectResult,
  ActorStreamingHandler,
  ActorStreamingRequest,
} from '../types/invocation.js';
import { createActorGenerationProtocol } from './generation-protocol.js';
import { composeActorInstructions } from '../instructions.js';
import { runActorInvocation } from './deadline.js';

export async function invokeActorStream(
  definition: ActorInvocationBinding,
  stream: ActorStreamingHandler,
  request: ActorStreamingRequest
): Promise<ActorDirectResult> {
  const boundary: { failure?: { readonly cause: unknown } } = {};
  try {
    return await runActorInvocation(
      {
        actorId: definition.id,
        invocationKind: 'stream',
        parentSignal: request.signal,
        policy: definition.invocationPolicy,
      },
      async (parentSignal, assertWithinDeadline) => {
        const controller = new AbortController();
        const signal = AbortSignal.any([parentSignal, controller.signal]);
        const protocol = createActorGenerationProtocol({
          request,
          signal,
          assertWithinDeadline,
          onFailure: (cause) => {
            // Preserve a terminal failure observed before a later outer deadline during drainage.
            if (!parentSignal.aborted) boundary.failure ??= { cause };
            controller.abort(cause);
          },
        });
        let result: unknown;
        try {
          signal.throwIfAborted();
          result = await stream({
            ...request,
            signal,
            instructions: composeActorInstructions(definition.instructions, request.instructions),
            invocationConfig: definition.invocationConfig,
            emit: protocol.emit,
          });
        } catch (cause) {
          const failure = protocol.fail(cause);
          protocol.close();
          await protocol.drain();
          throw failure;
        } finally {
          protocol.close();
        }
        return protocol.complete(result);
      }
    );
  } catch (cause) {
    if (boundary.failure !== undefined) throw boundary.failure.cause;
    throw cause;
  }
}
