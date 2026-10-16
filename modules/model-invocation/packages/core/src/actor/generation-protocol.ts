import {
  defineModelGenerationEvent,
  ModelInvocationError,
  type AssistantModelMessage,
  type ModelGenerationEventSink,
  type ModelGenerationEvent,
} from '../model/index.js';
import type { ActorStreamingRequest } from './engine.js';
import {
  normalizeActorDirectResult,
  sameAssistantMessage,
  protocolFailure,
} from './result-protocol.js';

interface GenerationProtocolOptions {
  readonly request: ActorStreamingRequest;
  readonly signal: AbortSignal;
  readonly assertWithinDeadline: () => void;
  readonly onFailure: (cause: unknown) => void;
}

/** One delivery queue, bounded by the explicit character budgets. No interaction lifecycle. */
export function createActorGenerationProtocol(options: GenerationProtocolOptions) {
  const { request, signal } = options;
  for (const limit of [request.maxOutputCharacters, request.maxReasoningCharacters]) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new ModelInvocationError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Generation character budgets must be positive safe integers.'
      );
    }
  }
  let accepting = true;
  let failure: { readonly cause: unknown } | undefined;
  let terminal: AssistantModelMessage | undefined;
  let outputCharacters = 0;
  let reasoningCharacters = 0;
  const textChunks: string[] = [];
  let delivery = Promise.resolve();

  function lock(cause: unknown): unknown {
    if (failure === undefined) {
      failure = { cause };
      options.onFailure(cause);
    }
    return failure.cause;
  }
  function assertValid(): void {
    if (failure !== undefined) throw failure.cause;
  }
  function assertActive(): void {
    assertValid();
    signal.throwIfAborted();
    options.assertWithinDeadline();
  }
  const emit: ModelGenerationEventSink = (input) => {
    if (!accepting) {
      const cause = protocolFailure('Streaming Engine emitted after its invocation settled.');
      lock(cause);
      const rejected = Promise.reject<void>(cause);
      void rejected.catch(() => undefined);
      return rejected;
    }
    try {
      assertActive();
      if (terminal !== undefined) {
        throw protocolFailure(
          'Streaming Engine emitted after its terminal event or invocation settlement.'
        );
      }
      let event: ModelGenerationEvent;
      try {
        event = defineModelGenerationEvent(input);
      } catch (cause) {
        throw protocolFailure('Streaming Engine emitted an invalid generation event.', cause);
      }
      if (event.type === 'assistant-complete') {
        if (event.message.text.length > request.maxOutputCharacters) {
          throw new ModelInvocationError(
            'MODEL_OUTPUT_LIMIT_EXCEEDED',
            'Streaming terminal output exceeded its character budget.'
          );
        }
        terminal = event.message;
        return Promise.resolve();
      }
      if (event.delta.length === 0) return Promise.resolve();
      if (event.type === 'text-delta') {
        outputCharacters += event.delta.length;
        if (outputCharacters > request.maxOutputCharacters) {
          throw new ModelInvocationError(
            'MODEL_OUTPUT_LIMIT_EXCEEDED',
            'Streaming output exceeded its character budget.'
          );
        }
        textChunks.push(event.delta);
      } else {
        reasoningCharacters += event.delta.length;
        if (reasoningCharacters > request.maxReasoningCharacters) {
          throw new ModelInvocationError(
            'MODEL_REASONING_LIMIT_EXCEEDED',
            'Streaming reasoning exceeded its character budget.'
          );
        }
      }
      const work = delivery.then(async () => {
        assertActive();
        await request.emit(event);
        assertActive();
      });
      // Observe the same promise returned to the Engine, including unawaited emission.
      delivery = work.catch((cause) => {
        lock(cause);
      });
      return work;
    } catch (cause) {
      const failure = lock(cause);
      const rejected = Promise.resolve().then(() => {
        throw failure;
      });
      void rejected.catch(() => undefined);
      return rejected;
    }
  };
  return {
    emit,
    fail: lock,
    close: () => {
      accepting = false;
    },
    drain: () => delivery,
    async complete(result: unknown) {
      accepting = false;
      await delivery;
      assertActive();
      const normalized = normalizeActorDirectResult(result, request.maxOutputCharacters);
      if (terminal === undefined || !sameAssistantMessage(terminal, normalized.message)) {
        throw protocolFailure(
          'Streaming terminal message must match the returned generation result.'
        );
      }
      if (textChunks.length > 0 && textChunks.join('') !== terminal.text) {
        throw protocolFailure('Streaming text deltas must match the terminal assistant text.');
      }
      await request.emit(Object.freeze({ type: 'assistant-complete', message: terminal }));
      assertActive();
      return normalized;
    },
  };
}
