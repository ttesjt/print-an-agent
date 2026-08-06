import {
  createModels,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Models,
  type UserMessage,
} from '@earendil-works/pi-ai';
import {
  runAgentLoop,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopRequest,
  type AgentLoopResult,
  type AgentLoopRuntime,
  type AssistantModelMessage,
  type ProviderModelReference,
  type ResolvedExecutionTarget,
} from '@ta-agent/base-model';
import {
  cloneRequestSnapshot,
  createResponseMessage,
  toModelMessage,
  toPiMessage,
} from './pi-message-mapping.js';
import type {
  PiFauxRequestSnapshot,
  PiFauxRuntimeInspection,
  PiFauxRuntimeOptions,
  PiFauxRuntimeProfile,
} from './types.js';

const DEFAULT_PROVIDER_ID = 'faux';
const DEFAULT_MODEL_ID = 'faux-model';
const DEFAULT_CHARACTERS_PER_CHUNK = 3;

function validatePositiveNumber(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', `${name} must be positive.`);
  }
}

interface PiRunState {
  outputCharacters: number;
  completedMessage?: AssistantModelMessage;
  terminalFailure?: AssistantMessage;
  limitFailure?: AgentModelError;
  eventSinkFailure?: Error;
}

function normalizeEventSinkFailure(error: unknown): Error {
  return error instanceof Error
    ? error
    : new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'The Agent Loop event sink rejected with a non-Error value.',
        { cause: error }
      );
}

async function handleMessageUpdate(
  request: AgentLoopRequest,
  event: Extract<AgentEvent, { type: 'message_update' }>,
  internalAbort: AbortController,
  state: PiRunState
): Promise<void> {
  const update = event.assistantMessageEvent;
  if (
    update.type === 'toolcall_start' ||
    update.type === 'toolcall_delta' ||
    update.type === 'toolcall_end'
  ) {
    internalAbort.abort();
    throw new AgentModelError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'The model proposed a tool call while the effective tool set was empty.'
    );
  }
  if (update.type !== 'text_delta') return;

  state.outputCharacters += update.delta.length;
  if (state.outputCharacters > request.maxOutputCharacters) {
    state.limitFailure = new AgentModelError(
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      `Model output exceeded ${request.maxOutputCharacters} characters.`
    );
    internalAbort.abort();
    throw state.limitFailure;
  }
  await request.emit(Object.freeze({ type: 'text-delta', delta: update.delta }));
}

async function handleMessageEnd(
  request: AgentLoopRequest,
  event: Extract<AgentEvent, { type: 'message_end' }>,
  state: PiRunState
): Promise<void> {
  if (event.message.role !== 'assistant') return;
  if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') {
    state.terminalFailure = event.message;
    return;
  }
  if (event.message.stopReason === 'toolUse') return;

  const normalized = toModelMessage(event.message);
  if (normalized?.role !== 'assistant') {
    throw new AgentModelError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Pi completed without a valid assistant message.'
    );
  }
  state.completedMessage = normalized;
  await request.emit(Object.freeze({ type: 'assistant-complete', message: normalized }));
}

function createPiEventSink(
  request: AgentLoopRequest,
  internalAbort: AbortController,
  state: PiRunState
): (event: AgentEvent) => Promise<void> {
  return async (event) => {
    try {
      if (event.type === 'message_update') {
        await handleMessageUpdate(request, event, internalAbort, state);
      }
      if (event.type === 'message_end') {
        await handleMessageEnd(request, event, state);
      }
      await emitLifecycleEvent(request, event);
    } catch (error: unknown) {
      state.eventSinkFailure = normalizeEventSinkFailure(error);
      internalAbort.abort();
      throw state.eventSinkFailure;
    }
  };
}

function throwTerminalFailure(request: AgentLoopRequest, failure: AssistantMessage): never {
  const cancelled = failure.stopReason === 'aborted' || request.signal.aborted;
  const timedOut =
    request.signal.reason instanceof DOMException && request.signal.reason.name === 'TimeoutError';
  throw new AgentModelError(
    timedOut
      ? 'MODEL_INVOCATION_TIMEOUT'
      : cancelled
        ? 'MODEL_INVOCATION_CANCELLED'
        : 'MODEL_PROVIDER_FAILED',
    failure.errorMessage ??
      (cancelled ? 'Model invocation was cancelled.' : 'Model provider failed.')
  );
}

class PiFauxAgentLoopRuntime implements AgentLoopRuntime {
  readonly #models: Models;
  readonly #modelReference: ProviderModelReference;
  readonly #targetModels = new WeakMap<ResolvedExecutionTarget, Model<Api>>();
  readonly #requests: PiFauxRequestSnapshot[];

  constructor(
    models: Models,
    modelReference: ProviderModelReference,
    requests: PiFauxRequestSnapshot[]
  ) {
    this.#models = models;
    this.#modelReference = modelReference;
    this.#requests = requests;
  }

  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget> {
    return Promise.resolve().then(() => {
      const model = this.#models.getModel(reference.provider, reference.model);
      if (model === undefined) {
        throw new AgentModelError(
          'MODEL_TARGET_NOT_FOUND',
          `Provider model "${reference.provider}/${reference.model}" is not registered.`
        );
      }
      const target: ResolvedExecutionTarget = Object.freeze({
        reference,
        capabilities: Object.freeze({ streaming: true, tools: false }),
      });
      this.#targetModels.set(target, model);
      return target;
    });
  }

  async run(request: AgentLoopRequest): Promise<AgentLoopResult> {
    const model = this.#targetModels.get(request.target);
    if (
      model === undefined ||
      request.target.reference.provider !== this.#modelReference.provider
    ) {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Execution target was not resolved by this Pi runtime.'
      );
    }

    const internalAbort = new AbortController();
    const signal = AbortSignal.any([request.signal, internalAbort.signal]);
    const state: PiRunState = { outputCharacters: 0 };
    const piContext = {
      systemPrompt: request.instructions,
      messages: request.history.map((message) => toPiMessage(message, model)),
      tools: [],
    };
    const prompt: UserMessage = {
      role: 'user',
      content: request.prompt.text,
      timestamp: request.prompt.timestamp,
    };
    const streamFn: StreamFn = (selectedModel, context, options) =>
      this.#models.streamSimple(selectedModel, context, options);

    try {
      await runAgentLoop(
        [prompt],
        piContext,
        {
          model,
          convertToLlm: (messages) => messages.filter(isStandardMessage),
        },
        createPiEventSink(request, internalAbort, state),
        signal,
        streamFn
      );
    } catch (error: unknown) {
      if (state.limitFailure !== undefined) throw state.limitFailure;
      if (state.eventSinkFailure !== undefined) throw state.eventSinkFailure;
      throw error;
    }

    if (state.terminalFailure !== undefined) throwTerminalFailure(request, state.terminalFailure);
    if (state.completedMessage === undefined) {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Pi completed without a terminal assistant response.'
      );
    }
    return Object.freeze({ message: state.completedMessage });
  }

  inspectRequests(): readonly PiFauxRequestSnapshot[] {
    return Object.freeze(this.#requests.map(cloneRequestSnapshot));
  }
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}

async function emitLifecycleEvent(request: AgentLoopRequest, event: AgentEvent): Promise<void> {
  if (event.type === 'agent_start')
    await request.emit(Object.freeze({ type: 'interaction-start' }));
  if (event.type === 'turn_start') await request.emit(Object.freeze({ type: 'turn-start' }));
  if (event.type === 'turn_end') await request.emit(Object.freeze({ type: 'turn-end' }));
  if (event.type === 'agent_end') await request.emit(Object.freeze({ type: 'interaction-end' }));
}

function snapshotFromPiContext(context: Context, callIndex: number): PiFauxRequestSnapshot {
  return Object.freeze({
    callIndex,
    instructions: context.systemPrompt ?? '',
    messages: Object.freeze(
      context.messages.flatMap((message) => {
        const normalized = toModelMessage(message);
        return normalized === undefined ? [] : [normalized];
      })
    ),
  });
}

export function createPiFauxRuntime(options: PiFauxRuntimeOptions): PiFauxRuntimeProfile {
  validatePositiveNumber(options.charactersPerChunk, 'charactersPerChunk');
  validatePositiveNumber(options.tokensPerSecond, 'tokensPerSecond');
  if (options.responses.length === 0) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'Pi faux runtime requires at least one deterministic response.'
    );
  }
  const providerId = options.providerId ?? DEFAULT_PROVIDER_ID;
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const chunkSize = options.charactersPerChunk ?? DEFAULT_CHARACTERS_PER_CHUNK;
  const handle = fauxProvider({
    provider: providerId,
    models: [{ id: modelId }],
    tokenSize: { min: chunkSize, max: chunkSize },
    ...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
  });
  const requests: PiFauxRequestSnapshot[] = [];
  handle.setResponses(
    options.responses.map((definition) => async (context) => {
      const snapshot = snapshotFromPiContext(context, requests.length + 1);
      requests.push(snapshot);
      const response =
        typeof definition === 'function'
          ? await definition(cloneRequestSnapshot(snapshot))
          : definition;
      return createResponseMessage(response);
    })
  );
  const models = createModels();
  models.setProvider(handle.provider);
  const modelReference = defineProviderModelReference({ provider: providerId, model: modelId });
  const runtime = new PiFauxAgentLoopRuntime(models, modelReference, requests);

  return Object.freeze({
    runtime,
    modelReference,
    inspect(): PiFauxRuntimeInspection {
      return Object.freeze({
        callCount: handle.state.callCount,
        pendingResponseCount: handle.getPendingResponseCount(),
        requests: runtime.inspectRequests(),
      });
    },
  });
}
