import type { Api, Context, Message, Model, Models, UserMessage } from '@earendil-works/pi-ai';
import { runAgentLoop, type AgentMessage, type StreamFn } from '@earendil-works/pi-agent-core';
import {
  defineActorEngine,
  type ActorDirectResult,
  type ActorEngine,
  type ActorEngineDirectRequest,
  type ActorEngineInteractionRequest,
  type ActorInvocationConfig,
} from '@ta-agent/base-actor';
import {
  AgentModelError,
  type AgentLoopRequest,
  type AgentLoopResult,
  type AgentLoopRuntime,
  type ProviderApiKeyCredential,
  type ProviderCredentialResolver,
  type ProviderModelReference,
  type ResolvedExecutionTarget,
} from '@ta-agent/base-model';
import { AgentToolError } from '@ta-agent/base-tool';
import {
  createPiEventSink,
  throwTerminalFailure,
  type PiRunState,
  type PiToolEventObserver,
} from './pi-event-adapter.js';
import { toModelMessage, toPiMessage } from './pi-message-mapping.js';
import { createPiTools, type PiToolAdapterState } from './pi-tool-adapter.js';

const MAX_API_KEY_CHARACTERS = 65_536;

interface PiActorRuntimeHooks {
  readonly observeInvocation?: (
    context: Context,
    kind: 'agent-loop' | 'direct',
    config: ActorInvocationConfig
  ) => void;
  readonly observeToolEvent?: PiToolEventObserver;
}

interface PiActorRuntimeOptions {
  readonly models: Models;
  readonly model: Model<Api>;
  readonly modelReference: ProviderModelReference;
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

function toPiInvocationOptions(config: ActorInvocationConfig, apiKey: string | undefined) {
  return {
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.maxOutputTokens === undefined ? {} : { maxTokens: config.maxOutputTokens }),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

function invocationInterruption(signal: AbortSignal): AgentModelError {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  return new AgentModelError(
    timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
    timedOut ? 'Model invocation timed out.' : 'Model invocation was cancelled.'
  );
}

function normalizeProviderFailure(cause: unknown, signal: AbortSignal): Error {
  if (cause instanceof AgentModelError || cause instanceof AgentToolError) return cause;
  if (signal.aborted) return invocationInterruption(signal);
  return new AgentModelError('MODEL_PROVIDER_FAILED', 'Pi provider invocation failed.', { cause });
}

function validateResolvedCredential(value: unknown): ProviderApiKeyCredential | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'apiKey') ||
    !('type' in value) ||
    value.type !== 'api-key' ||
    !('apiKey' in value) ||
    typeof value.apiKey !== 'string' ||
    value.apiKey.length === 0 ||
    value.apiKey.length > MAX_API_KEY_CHARACTERS
  ) {
    throw new AgentModelError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Provider credential resolver returned an invalid API-key credential.'
    );
  }
  return Object.freeze({ type: 'api-key', apiKey: value.apiKey });
}

export class PiActorRuntime implements AgentLoopRuntime {
  readonly #models: Models;
  readonly #model: Model<Api>;
  readonly #modelReference: ProviderModelReference;
  readonly #credentialResolver: ProviderCredentialResolver | undefined;
  readonly #hooks: PiActorRuntimeHooks;
  readonly #targetModels = new WeakMap<ResolvedExecutionTarget, Model<Api>>();

  constructor(options: PiActorRuntimeOptions) {
    this.#models = options.models;
    this.#model = options.model;
    this.#modelReference = options.modelReference;
    this.#credentialResolver = options.credentialResolver;
    this.#hooks = options.hooks ?? Object.freeze({});
  }

  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget> {
    return Promise.resolve().then(() => {
      if (!sameReference(reference, this.#modelReference)) {
        throw new AgentModelError(
          'MODEL_TARGET_NOT_FOUND',
          `Provider model "${reference.provider}/${reference.model}" is not bound to this Pi runtime.`
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

  async run(request: AgentLoopRequest): Promise<AgentLoopResult> {
    return this.#run(request, Object.freeze({}));
  }

  async interact(request: ActorEngineInteractionRequest): Promise<AgentLoopResult> {
    const target = await this.resolveTarget(this.#modelReference);
    return this.#run({ ...request, target }, request.invocationConfig);
  }

  async checkCredential(signal: AbortSignal): Promise<'ready' | 'credential-unavailable'> {
    try {
      await this.#resolveApiKey(signal);
      return 'ready';
    } catch (error: unknown) {
      if (error instanceof AgentModelError && error.code === 'MODEL_CREDENTIAL_NOT_FOUND') {
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
      throw new AgentModelError(
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
      if (cause instanceof AgentModelError && cause.code === 'MODEL_CREDENTIAL_RESOLUTION_FAILED') {
        throw cause;
      }
      throw new AgentModelError(
        'MODEL_CREDENTIAL_RESOLUTION_FAILED',
        'Provider credential resolution failed.',
        { cause }
      );
    }
    if (resolved === undefined) {
      throw new AgentModelError(
        'MODEL_CREDENTIAL_NOT_FOUND',
        'Provider credential is unavailable.'
      );
    }
    return resolved.apiKey;
  }

  async #run(
    request: AgentLoopRequest,
    invocationConfig: ActorInvocationConfig
  ): Promise<AgentLoopResult> {
    const model = this.#targetModels.get(request.target);
    if (model === undefined || !sameReference(request.target.reference, this.#modelReference)) {
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
    const apiKey = await this.#resolveApiKey(request.signal);
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
    this.#hooks.observeInvocation?.(piContext, 'agent-loop', invocationConfig);
    const prompt: UserMessage = {
      role: 'user',
      content: request.prompt.text,
      timestamp: request.prompt.timestamp,
    };
    const streamFn: StreamFn = (selectedModel, context, options) => {
      this.#hooks.observeInvocation?.(context, 'agent-loop', invocationConfig);
      return this.#models.streamSimple(selectedModel, context, {
        ...options,
        ...toPiInvocationOptions(invocationConfig, apiKey),
      });
    };

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
        createPiEventSink(request, internalAbort, state, this.#hooks.observeToolEvent),
        signal,
        streamFn
      );
    } catch (cause: unknown) {
      if (state.toolAdapter.terminalFailure !== undefined) {
        throw state.toolAdapter.terminalFailure;
      }
      if (state.limitFailure !== undefined) throw state.limitFailure;
      if (state.eventSinkFailure !== undefined) throw state.eventSinkFailure;
      throw normalizeProviderFailure(cause, request.signal);
    }

    if (state.toolAdapter.terminalFailure !== undefined) throw state.toolAdapter.terminalFailure;
    if (state.providerTurnFailure !== undefined) throw state.providerTurnFailure;
    if (state.terminalFailure !== undefined) {
      throwTerminalFailure(request.signal, state.terminalFailure);
    }
    if (state.completedMessage === undefined) {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Pi completed without a terminal assistant response.'
      );
    }
    return Object.freeze({ message: state.completedMessage });
  }

  async complete(request: ActorEngineDirectRequest): Promise<ActorDirectResult> {
    if (!Number.isSafeInteger(request.maxOutputCharacters) || request.maxOutputCharacters < 1) {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Direct Actor invocation maxOutputCharacters must be a positive safe integer.'
      );
    }
    const apiKey = await this.#resolveApiKey(request.signal);
    const piContext: Context = {
      systemPrompt: request.instructions,
      messages: request.messages.map((message) => toPiMessage(message, this.#model)),
    };
    this.#hooks.observeInvocation?.(piContext, 'direct', request.invocationConfig);

    let response;
    try {
      response = await this.#models.completeSimple(this.#model, piContext, {
        signal: request.signal,
        ...toPiInvocationOptions(request.invocationConfig, apiKey),
      });
    } catch (cause: unknown) {
      throw normalizeProviderFailure(cause, request.signal);
    }
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throwTerminalFailure(request.signal, response);
    }
    if (response.stopReason === 'toolUse') {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Pi direct Actor invocation produced an unsupported Tool call.'
      );
    }
    const normalized = toModelMessage(response);
    if (normalized?.role !== 'assistant') {
      throw new AgentModelError(
        'MODEL_RUNTIME_PROTOCOL_INVALID',
        'Pi direct Actor invocation did not produce an assistant message.'
      );
    }
    if (normalized.text.length === 0 || normalized.text.length > request.maxOutputCharacters) {
      throw new AgentModelError(
        'MODEL_OUTPUT_LIMIT_EXCEEDED',
        `Pi direct Actor output must contain 1-${request.maxOutputCharacters} characters.`
      );
    }
    return Object.freeze({ message: normalized });
  }
}

export function createPiActorEngine(
  runtime: PiActorRuntime,
  engineId: string,
  maxContextTokens: number
): ActorEngine {
  return defineActorEngine({
    id: engineId,
    capabilities: {
      invocationModes: ['interaction', 'direct'],
      inputMediaTypes: ['text'],
      interaction: { streamable: true },
      toolCalling: true,
      structuredOutput: false,
      cancellation: true,
      maxContextTokens,
    },
    interact: (request) => runtime.interact(request),
    complete: (request) => runtime.complete(request),
  });
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}
