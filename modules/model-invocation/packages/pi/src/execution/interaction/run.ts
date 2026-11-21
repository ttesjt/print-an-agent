import type { Message, UserMessage } from '@earendil-works/pi-ai';
import {
  runAgentLoop,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import {
  ModelInvocationError,
  type ActorInvocationConfig,
  type ModelInteractionRequest,
  type ModelInteractionResult,
} from '@print-an-agent/model-invocation-core';
import { toPiMessage, toPiInvocationOptions } from '../../translation/index.js';
import { normalizeProviderFailure, throwTerminalFailure } from '../failures.js';
import {
  createPiProviderTransportLivenessBoundary,
  type PiProviderTransportLivenessBoundary,
} from '../transport-liveness.js';
import type { PiRuntimeOptions, PiRuntimeHooks } from '../types.js';
import { createPiEventSink } from './events.js';
import { createPiTools } from './tools.js';
import type { PiInteractionState, PiToolAdapterState } from './types.js';

interface PiInteractionOptions extends Pick<
  PiRuntimeOptions,
  'models' | 'model' | 'transportLivenessPolicy'
> {
  readonly hooks: PiRuntimeHooks;
  readonly apiKey?: string;
}

/** One tool-capable invocation; each model turn owns a fresh transport boundary. */
export async function runPiInteraction(
  binding: PiInteractionOptions,
  request: ModelInteractionRequest,
  invocationConfig: ActorInvocationConfig
): Promise<ModelInteractionResult> {
  const model = binding.model;
  const apiKey = binding.apiKey;
  const internalAbort = new AbortController();
  const signal = AbortSignal.any([request.signal, internalAbort.signal]);
  let activeTransportBoundary: PiProviderTransportLivenessBoundary | undefined;
  let transportFailure: ModelInvocationError | undefined;
  const toolAdapter: PiToolAdapterState = { attemptedCallIds: new Set() };
  const state: PiInteractionState = {
    outputCharacters: 0,
    modelTurns: 0,
    turnTextDeltas: [],
    toolAdapter,
  };
  const piContext = {
    systemPrompt: request.instructions,
    messages: request.history.map((message) => toPiMessage(message, model)),
    tools: createPiTools(request.tools, toolAdapter),
  };
  binding.hooks.observeInvocation?.(piContext, 'agent-loop', invocationConfig);
  const prompt: UserMessage = {
    role: 'user',
    content: request.prompt.text,
    timestamp: request.prompt.timestamp,
  };
  const streamFn: StreamFn = (selectedModel, context, options) => {
    binding.hooks.observeInvocation?.(context, 'agent-loop', invocationConfig);
    activeTransportBoundary?.close();
    const boundary = createPiProviderTransportLivenessBoundary({
      parentSignal: options?.signal ?? signal,
      policy: binding.transportLivenessPolicy,
      onTimeout: (failure) => {
        transportFailure ??= failure;
      },
    });
    activeTransportBoundary = boundary;
    const onResponse = options?.onResponse;
    return binding.models.streamSimple(selectedModel, context, {
      ...options,
      ...toPiInvocationOptions(invocationConfig, apiKey),
      signal: boundary.signal,
      onResponse: async (response, responseModel) => {
        boundary.responseStarted();
        await onResponse?.(response, responseModel);
      },
    });
  };
  const eventSink = createPiEventSink(
    request,
    internalAbort,
    state,
    binding.hooks.observeToolEvent
  );

  try {
    await runAgentLoop(
      [prompt],
      piContext,
      {
        model,
        convertToLlm: (messages) => messages.filter(isStandardMessage),
        toolExecution: 'sequential',
        shouldStopAfterTurn: ({ message }) => {
          if (state.toolAdapter.terminalFailure !== undefined) return true;
          if (message.stopReason === 'toolUse' && state.modelTurns >= request.maxModelTurns) {
            state.modelTurnFailure = new ModelInvocationError(
              'MODEL_TURN_LIMIT_EXCEEDED',
              `Model turn budget ${request.maxModelTurns} was exhausted before a final response.`
            );
            return true;
          }
          return false;
        },
      },
      async (event) => {
        const providerEvent = observeProviderStreamActivity(activeTransportBoundary, event);
        await eventSink(event);
        if (providerEvent && event.type !== 'message_end') {
          activeTransportBoundary?.waitForNextStreamEvent();
        }
      },
      signal,
      streamFn
    );
  } catch (cause: unknown) {
    if (state.toolAdapter.terminalFailure !== undefined) {
      throw state.toolAdapter.terminalFailure.cause;
    }
    if (state.limitFailure !== undefined) throw state.limitFailure;
    if (state.eventSinkFailure !== undefined) throw state.eventSinkFailure;
    if (transportFailure !== undefined) throw transportFailure;
    throw normalizeProviderFailure(cause, request.signal);
  } finally {
    activeTransportBoundary?.close();
  }

  if (state.toolAdapter.terminalFailure !== undefined)
    throw state.toolAdapter.terminalFailure.cause;
  if (state.modelTurnFailure !== undefined) throw state.modelTurnFailure;
  if (transportFailure !== undefined) throw transportFailure;
  if (state.terminalFailure !== undefined) {
    throwTerminalFailure(request.signal, state.terminalFailure);
  }
  if (state.completedMessage === undefined) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Provider completed without a terminal assistant response.'
    );
  }
  return Object.freeze({ message: state.completedMessage });
}

function observeProviderStreamActivity(
  boundary: PiProviderTransportLivenessBoundary | undefined,
  event: AgentEvent
): boolean {
  if (
    boundary === undefined ||
    (event.type !== 'message_start' &&
      event.type !== 'message_update' &&
      event.type !== 'message_end')
  ) {
    return false;
  }
  boundary.streamEventReceived();
  if (event.type === 'message_end') boundary.close();
  return true;
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}
