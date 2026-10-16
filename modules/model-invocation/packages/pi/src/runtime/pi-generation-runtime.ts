import type {
  Api,
  Context,
  Model,
  Models,
  AssistantMessageEventStream,
  AssistantMessage,
} from '@earendil-works/pi-ai';
import {
  ModelInvocationError,
  type ActorEngineDirectRequest,
  type ActorEngineStreamingRequest,
  type ProviderTransportLivenessPolicy,
  type ModelGenerationEventSink,
} from '@ta-agent/model-invocation-core';
import { toPiInvocationOptions, normalizeProviderFailure } from './pi-invocation.js';
import { readablePiDelta } from './pi-generation-event.js';
import { toModelMessage } from './pi-message-mapping.js';
import {
  createPiProviderTransportLivenessBoundary,
  type PiProviderTransportLivenessBoundary,
} from './pi-provider-transport-liveness.js';
import { throwTerminalFailure } from './pi-event-adapter.js';

interface PiGenerationOptions {
  readonly models: Models;
  readonly model: Model<Api>;
  readonly context: Context;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
  readonly apiKey?: string;
}

/** One provider generation, collected or streamed; neither path executes tools. */
export function validatePiGenerationBudgets(
  request: ActorEngineDirectRequest,
  streaming?: ActorEngineStreamingRequest
): void {
  if (!Number.isSafeInteger(request.maxOutputCharacters) || request.maxOutputCharacters < 1) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Generation output budget must be a positive safe integer.'
    );
  }
  if (
    streaming !== undefined &&
    (!Number.isSafeInteger(streaming.maxReasoningCharacters) ||
      streaming.maxReasoningCharacters < 1)
  ) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Generation reasoning budget must be a positive safe integer.'
    );
  }
}

export async function runPiGeneration(
  options: PiGenerationOptions,
  request: ActorEngineDirectRequest,
  streaming?: ActorEngineStreamingRequest
) {
  validatePiGenerationBudgets(request, streaming);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let transportFailure: ModelInvocationError | undefined;
  const boundary = createPiProviderTransportLivenessBoundary({
    parentSignal: signal,
    policy: options.transportLivenessPolicy,
    onTimeout: (failure) => {
      transportFailure ??= failure;
    },
  });
  let stream: AssistantMessageEventStream | undefined;
  let deliveryFailure: { readonly cause: unknown } | undefined;
  const deliver: ModelGenerationEventSink = async (event) => {
    if (streaming === undefined) return;
    try {
      await streaming.emit(event);
    } catch (cause) {
      deliveryFailure = { cause };
      throw cause;
    }
  };
  try {
    signal.throwIfAborted();
    stream = options.models.streamSimple(options.model, options.context, {
      ...toPiInvocationOptions(request.invocationConfig, options.apiKey),
      signal: boundary.signal,
      onResponse: () => {
        boundary.responseStarted();
      },
    });
    await consumeGeneration(stream, boundary, request, streaming, deliver);
    if (transportFailure !== undefined) throw transportFailure;
    const response = await stream.result();
    const message = normalizeGenerationResponse(response, request);
    signal.throwIfAborted();
    if (streaming !== undefined) {
      await deliver(Object.freeze({ type: 'assistant-complete', message }));
      signal.throwIfAborted();
    }
    return Object.freeze({ message });
  } catch (cause) {
    controller.abort(cause);
    // Stop and join the actual provider producer before releasing the transport boundary.
    if (stream !== undefined) await stream.result().catch(() => undefined);
    if (deliveryFailure !== undefined) throw deliveryFailure.cause;
    if (transportFailure !== undefined) throw transportFailure;
    throw normalizeProviderFailure(cause, request.signal);
  } finally {
    boundary.close();
  }
}

async function consumeGeneration(
  stream: AssistantMessageEventStream,
  boundary: PiProviderTransportLivenessBoundary,
  request: ActorEngineDirectRequest,
  streaming: ActorEngineStreamingRequest | undefined,
  deliver: ModelGenerationEventSink
): Promise<void> {
  let outputCharacters = 0;
  let reasoningCharacters = 0;
  for await (const event of stream) {
    boundary.streamEventReceived();
    if (event.type === 'text_delta') {
      outputCharacters += event.delta.length;
      if (outputCharacters > request.maxOutputCharacters) {
        throw new ModelInvocationError(
          'MODEL_OUTPUT_LIMIT_EXCEEDED',
          'Generation exceeded its output character budget.'
        );
      }
    }
    if (streaming !== undefined) {
      const delta = readablePiDelta(event);
      if (delta !== undefined) {
        if (delta.type === 'reasoning-delta') reasoningCharacters += delta.delta.length;
        if (reasoningCharacters > streaming.maxReasoningCharacters) {
          throw new ModelInvocationError(
            'MODEL_REASONING_LIMIT_EXCEEDED',
            'Generation exceeded its reasoning character budget.'
          );
        }
        await deliver(delta);
      }
    }
    if (event.type === 'done' || event.type === 'error') boundary.close();
    else boundary.waitForNextStreamEvent();
  }
}
function normalizeGenerationResponse(
  response: AssistantMessage,
  request: ActorEngineDirectRequest
) {
  if (response.stopReason === 'error' || response.stopReason === 'aborted')
    throwTerminalFailure(request.signal, response);
  if (response.stopReason === 'toolUse') {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Single generation cannot execute Tool calls.'
    );
  }
  const message = toModelMessage(response);
  if (message?.role !== 'assistant')
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Provider did not return an assistant message.'
    );
  if (message.text.length === 0 || message.text.length > request.maxOutputCharacters) {
    throw new ModelInvocationError(
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      'Provider returned empty or over-budget assistant text.'
    );
  }

  return message;
}
