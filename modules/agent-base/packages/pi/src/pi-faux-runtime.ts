import {
  createModels,
  fauxProvider,
  type Api,
  type Context,
  type Message,
  type Model,
  type Models,
  type UserMessage,
} from '@earendil-works/pi-ai';
import { runAgentLoop, type AgentMessage, type StreamFn } from '@earendil-works/pi-agent-core';
import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopRequest,
  type AgentLoopResult,
  type AgentLoopRuntime,
  type ProviderModelReference,
  type ResolvedExecutionTarget,
} from '@ta-agent/base-model';
import { createPiEventSink, throwTerminalFailure, type PiRunState } from './pi-event-adapter.js';
import {
  cloneRequestSnapshot,
  createResponseMessage,
  toModelMessage,
  toPiMessage,
  toToolResultSnapshot,
} from './pi-message-mapping.js';
import { createPiTools, type PiToolAdapterState } from './pi-tool-adapter.js';
import type {
  PiFauxRequestSnapshot,
  PiFauxRuntimeInspection,
  PiFauxRuntimeOptions,
  PiFauxRuntimeProfile,
  PiFauxToolEventSnapshot,
} from './types.js';

const DEFAULT_PROVIDER_ID = 'faux';
const DEFAULT_MODEL_ID = 'faux-model';
const DEFAULT_CHARACTERS_PER_CHUNK = 3;

function validatePositiveNumber(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', `${name} must be positive.`);
  }
}

class PiFauxAgentLoopRuntime implements AgentLoopRuntime {
  readonly #models: Models;
  readonly #modelReference: ProviderModelReference;
  readonly #targetModels = new WeakMap<ResolvedExecutionTarget, Model<Api>>();
  readonly #requests: PiFauxRequestSnapshot[];
  readonly #toolEvents: PiFauxToolEventSnapshot[];

  constructor(
    models: Models,
    modelReference: ProviderModelReference,
    requests: PiFauxRequestSnapshot[],
    toolEvents: PiFauxToolEventSnapshot[]
  ) {
    this.#models = models;
    this.#modelReference = modelReference;
    this.#requests = requests;
    this.#toolEvents = toolEvents;
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
        capabilities: Object.freeze({ streaming: true, tools: true }),
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
    if (!Number.isSafeInteger(request.maxProviderTurns) || request.maxProviderTurns < 1) {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'maxProviderTurns must be a positive safe integer.'
      );
    }

    const internalAbort = new AbortController();
    const signal = AbortSignal.any([request.signal, internalAbort.signal]);
    const toolAdapter: PiToolAdapterState = { attemptedCallIds: new Set() };
    const state: PiRunState = {
      outputCharacters: 0,
      providerTurns: 0,
      turnTextDeltas: [],
      toolAdapter,
    };
    const piContext = {
      systemPrompt: request.instructions,
      messages: request.history.map((message) => toPiMessage(message, model)),
      tools: createPiTools(request.tools, toolAdapter),
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
          toolExecution: 'sequential',
          shouldStopAfterTurn: ({ message }) => {
            if (state.toolAdapter.terminalFailure !== undefined) return true;
            if (
              message.stopReason === 'toolUse' &&
              state.providerTurns >= request.maxProviderTurns
            ) {
              state.providerTurnFailure = new AgentModelError(
                'MODEL_PROVIDER_TURN_LIMIT_EXCEEDED',
                `Provider turn budget ${request.maxProviderTurns} was exhausted before a final response.`
              );
              return true;
            }
            return false;
          },
        },
        createPiEventSink(request, internalAbort, state, this.#toolEvents),
        signal,
        streamFn
      );
    } catch (error: unknown) {
      if (state.toolAdapter.terminalFailure !== undefined) {
        throw state.toolAdapter.terminalFailure;
      }
      if (state.limitFailure !== undefined) throw state.limitFailure;
      if (state.eventSinkFailure !== undefined) throw state.eventSinkFailure;
      throw error;
    }

    if (state.toolAdapter.terminalFailure !== undefined) throw state.toolAdapter.terminalFailure;
    if (state.providerTurnFailure !== undefined) throw state.providerTurnFailure;
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

  inspectToolEvents(): readonly PiFauxToolEventSnapshot[] {
    return Object.freeze(this.#toolEvents.map((event) => Object.freeze({ ...event })));
  }
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
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
    toolResults: Object.freeze(
      context.messages.flatMap((message) => {
        const normalized = toToolResultSnapshot(message);
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
  const toolEvents: PiFauxToolEventSnapshot[] = [];
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
  const runtime = new PiFauxAgentLoopRuntime(models, modelReference, requests, toolEvents);

  return Object.freeze({
    runtime,
    modelReference,
    inspect(): PiFauxRuntimeInspection {
      return Object.freeze({
        callCount: handle.state.callCount,
        pendingResponseCount: handle.getPendingResponseCount(),
        requests: runtime.inspectRequests(),
        toolEvents: runtime.inspectToolEvents(),
      });
    },
  });
}
