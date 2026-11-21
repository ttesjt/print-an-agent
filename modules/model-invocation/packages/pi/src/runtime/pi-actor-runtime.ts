import type { Api, Context, Message, Model, Models, UserMessage } from '@earendil-works/pi-ai';
import {
  runAgentLoop,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import {
  defineActorEngine,
  type ActorDirectResult,
  type ActorEngine,
  type ActorEngineDirectRequest,
  type ActorEngineStreamingRequest,
  type ActorEngineInteractionRequest,
  type ActorInvocationConfig,
} from '@print-an-agent/model-invocation-core';
import {
  ModelInvocationError,
  type ModelInteractionRequest,
  type ModelInteractionResult,
  type ModelInteractionRuntime,
  type ProviderApiKeyCredential,
  type ProviderCredentialResolver,
  type ProviderModelReference,
  type ProviderTransportLivenessPolicy,
  type ResolvedExecutionTarget,
} from '@print-an-agent/model-invocation-core';
import {
  createPiEventSink,
  throwTerminalFailure,
  type PiRunState,
  type PiToolEventObserver,
} from './pi-event-adapter.js';
import { toPiMessage } from './pi-message-mapping.js';
import {
  toPiInvocationOptions,
  invocationInterruption,
  normalizeProviderFailure,
} from './pi-invocation.js';
import { runPiGeneration, validatePiGenerationBudgets } from './pi-generation-runtime.js';
import {
  createPiProviderTransportLivenessBoundary,
  type PiProviderTransportLivenessBoundary,
} from './pi-provider-transport-liveness.js';
import { createPiTools, type PiToolAdapterState } from './pi-tool-adapter.js';

const MAX_API_KEY_CHARACTERS = 65_536;

interface PiActorRuntimeHooks {
  readonly observeInvocation?: (
    context: Context,
    kind: 'agent-loop' | 'direct' | 'stream',
    config: ActorInvocationConfig
  ) => void;
  readonly observeToolEvent?: PiToolEventObserver;
}

interface PiActorRuntimeOptions {
  readonly models: Models;
  readonly model: Model<Api>;
  readonly modelReference: ProviderModelReference;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly hooks?: PiActorRuntimeHooks;
}

function sameReference(left: ProviderModelReference, right: ProviderModelReference): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.baseUrl === right.baseUrl &&
    left.credentialRef === right.credentialRef
  );
}

function validateResolvedCredential(value: unknown): ProviderApiKeyCredential | undefined {
  if (value === undefined) return undefined;
  // Capture resolver-owned fields once; validate the same values that will reach Pi.
  const snapshot =
    typeof value === 'object' &&
    value !== null &&
    !Object.keys(value).some((key) => key !== 'type' && key !== 'apiKey') &&
    'type' in value &&
    'apiKey' in value
      ? { type: value.type, apiKey: value.apiKey }
      : undefined;
  if (
    snapshot?.type !== 'api-key' ||
    typeof snapshot.apiKey !== 'string' ||
    snapshot.apiKey.length === 0 ||
    snapshot.apiKey.length > MAX_API_KEY_CHARACTERS
  ) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Provider credential resolver returned an invalid API-key credential.'
    );
  }
  return Object.freeze({ type: 'api-key', apiKey: snapshot.apiKey });
}

export class PiActorRuntime implements ModelInteractionRuntime {
  readonly #models: Models;
  readonly #model: Model<Api>;
  readonly #modelReference: ProviderModelReference;
  readonly #transportLivenessPolicy: ProviderTransportLivenessPolicy;
  readonly #credentialResolver: ProviderCredentialResolver | undefined;
  readonly #hooks: PiActorRuntimeHooks;
  readonly #targetModels = new WeakMap<ResolvedExecutionTarget, Model<Api>>();

  constructor(options: PiActorRuntimeOptions) {
    this.#models = options.models;
    this.#model = options.model;
    this.#modelReference = options.modelReference;
    this.#transportLivenessPolicy = options.transportLivenessPolicy;
    this.#credentialResolver = options.credentialResolver;
    this.#hooks = options.hooks ?? Object.freeze({});
  }

  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget> {
    return Promise.resolve().then(() => {
      if (!sameReference(reference, this.#modelReference)) {
        throw new ModelInvocationError(
          'MODEL_TARGET_NOT_FOUND',
          `Provider model "${reference.provider}/${reference.model}" is not bound to this provider runtime.`
        );
      }
      const target: ResolvedExecutionTarget = Object.freeze({
        reference: this.#modelReference,
        capabilities: Object.freeze({ streaming: true, tools: true }),
      });
      this.#targetModels.set(target, this.#model);
      return target;
    });
  }

  async run(request: ModelInteractionRequest): Promise<ModelInteractionResult> {
    return this.#run(request, Object.freeze({}));
  }

  async interact(request: ActorEngineInteractionRequest): Promise<ModelInteractionResult> {
    const target = await this.resolveTarget(this.#modelReference);
    return this.#run({ ...request, target }, request.invocationConfig);
  }

  async checkCredential(signal: AbortSignal): Promise<'ready' | 'credential-unavailable'> {
    try {
      await this.#resolveApiKey(signal);
      return 'ready';
    } catch (error: unknown) {
      if (error instanceof ModelInvocationError && error.code === 'MODEL_CREDENTIAL_NOT_FOUND') {
        return 'credential-unavailable';
      }
      throw error;
    }
  }

  async #resolveApiKey(signal: AbortSignal): Promise<string | undefined> {
    if (signal.aborted) throw invocationInterruption(signal);
    const credentialRef = this.#modelReference.credentialRef;
    if (credentialRef === undefined) return undefined;
    if (this.#credentialResolver === undefined) {
      throw new ModelInvocationError(
        'MODEL_CREDENTIAL_NOT_FOUND',
        'Provider credential resolver is not configured.'
      );
    }
    let resolved: ProviderApiKeyCredential | undefined;
    try {
      resolved = validateResolvedCredential(
        await this.#credentialResolver.resolve(
          Object.freeze({
            reference: credentialRef,
            provider: this.#modelReference.provider,
            signal,
          })
        )
      );
    } catch (cause: unknown) {
      if (signal.aborted) throw invocationInterruption(signal);
      if (
        cause instanceof ModelInvocationError &&
        cause.code === 'MODEL_CREDENTIAL_RESOLUTION_FAILED'
      ) {
        throw cause;
      }
      throw new ModelInvocationError(
        'MODEL_CREDENTIAL_RESOLUTION_FAILED',
        'Provider credential resolution failed.',
        { cause }
      );
    }
    if (resolved === undefined) {
      throw new ModelInvocationError(
        'MODEL_CREDENTIAL_NOT_FOUND',
        'Provider credential is unavailable.'
      );
    }
    return resolved.apiKey;
  }

  async #run(
    request: ModelInteractionRequest,
    invocationConfig: ActorInvocationConfig
  ): Promise<ModelInteractionResult> {
    const model = this.#targetModels.get(request.target);
    if (model === undefined || !sameReference(request.target.reference, this.#modelReference)) {
      throw new ModelInvocationError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Execution target was not resolved by this provider runtime.'
      );
    }
    if (!Number.isSafeInteger(request.maxModelTurns) || request.maxModelTurns < 1) {
      throw new ModelInvocationError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'maxModelTurns must be a positive safe integer.'
      );
    }
    const apiKey = await this.#resolveApiKey(request.signal);
    const internalAbort = new AbortController();
    const signal = AbortSignal.any([request.signal, internalAbort.signal]);
    let activeTransportBoundary: PiProviderTransportLivenessBoundary | undefined;
    let transportFailure: ModelInvocationError | undefined;
    const toolAdapter: PiToolAdapterState = { attemptedCallIds: new Set() };
    const state: PiRunState = {
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
    this.#hooks.observeInvocation?.(piContext, 'agent-loop', invocationConfig);
    const prompt: UserMessage = {
      role: 'user',
      content: request.prompt.text,
      timestamp: request.prompt.timestamp,
    };
    const streamFn: StreamFn = (selectedModel, context, options) => {
      this.#hooks.observeInvocation?.(context, 'agent-loop', invocationConfig);
      activeTransportBoundary?.close();
      const boundary = createPiProviderTransportLivenessBoundary({
        parentSignal: options?.signal ?? signal,
        policy: this.#transportLivenessPolicy,
        onTimeout: (failure) => {
          transportFailure ??= failure;
        },
      });
      activeTransportBoundary = boundary;
      const onResponse = options?.onResponse;
      return this.#models.streamSimple(selectedModel, context, {
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
      this.#hooks.observeToolEvent
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

  complete(request: ActorEngineDirectRequest): Promise<ActorDirectResult> {
    return this.#generate(request);
  }
  stream(request: ActorEngineStreamingRequest): Promise<ActorDirectResult> {
    return this.#generate(request, request);
  }

  async #generate(
    request: ActorEngineDirectRequest,
    streaming?: ActorEngineStreamingRequest
  ): Promise<ActorDirectResult> {
    validatePiGenerationBudgets(request, streaming);
    const apiKey = await this.#resolveApiKey(request.signal);
    const context: Context = {
      systemPrompt: request.instructions,
      messages: request.messages.map((message) => toPiMessage(message, this.#model)),
    };
    this.#hooks.observeInvocation?.(
      context,
      streaming === undefined ? 'direct' : 'stream',
      request.invocationConfig
    );
    return runPiGeneration(
      {
        models: this.#models,
        model: this.#model,
        context,
        transportLivenessPolicy: this.#transportLivenessPolicy,
        ...(apiKey === undefined ? {} : { apiKey }),
      },
      request,
      streaming
    );
  }
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

export function createPiActorEngine(
  runtime: PiActorRuntime,
  engineId: string,
  maxContextTokens: number
): ActorEngine {
  return defineActorEngine({
    id: engineId,
    capabilities: {
      invocationModes: ['interaction', 'direct', 'stream'],
      inputMediaTypes: ['text'],
      interaction: { streamable: true },
      toolCalling: true,
      structuredOutput: false,
      cancellation: true,
      maxContextTokens,
    },
    interact: (request) => runtime.interact(request),
    complete: (request) => runtime.complete(request),
    stream: (request) => runtime.stream(request),
  });
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}
