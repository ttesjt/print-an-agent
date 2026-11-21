import type { Api, Context, Model, Models } from '@earendil-works/pi-ai';
import {
  ModelInvocationError,
  type ActorDirectResult,
  type ActorEngineDirectRequest,
  type ActorEngineStreamingRequest,
  type ActorEngineInteractionRequest,
  type ActorInvocationConfig,
  type ModelInteractionRequest,
  type ModelInteractionResult,
  type ModelInteractionRuntime,
  type ProviderCredentialResolver,
  type ProviderModelReference,
  type ProviderTransportLivenessPolicy,
  type ResolvedExecutionTarget,
} from '@print-an-agent/model-invocation-core';
import { toPiMessage } from '../translation/index.js';
import { resolvePiApiKey } from './credentials.js';
import { runPiGeneration, validatePiGenerationBudgets } from './generation.js';
import { runPiInteraction } from './interaction/index.js';
import type { PiRuntimeHooks, PiRuntimeOptions, PiRuntimeHandlers } from './types.js';

function sameReference(left: ProviderModelReference, right: ProviderModelReference): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.baseUrl === right.baseUrl &&
    left.credentialRef === right.credentialRef
  );
}

export class PiActorRuntime implements ModelInteractionRuntime, PiRuntimeHandlers {
  readonly #models: Models;
  readonly #model: Model<Api>;
  readonly #modelReference: ProviderModelReference;
  readonly #transportLivenessPolicy: ProviderTransportLivenessPolicy;
  readonly #credentialResolver: ProviderCredentialResolver | undefined;
  readonly #hooks: PiRuntimeHooks;
  readonly #targetModels = new WeakMap<ResolvedExecutionTarget, Model<Api>>();

  constructor(options: PiRuntimeOptions) {
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

  #resolveApiKey(signal: AbortSignal): Promise<string | undefined> {
    return resolvePiApiKey(this.#modelReference, this.#credentialResolver, signal);
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
    return runPiInteraction(
      {
        models: this.#models,
        model,
        transportLivenessPolicy: this.#transportLivenessPolicy,
        hooks: this.#hooks,
        ...(apiKey === undefined ? {} : { apiKey }),
      },
      request,
      invocationConfig
    );
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
