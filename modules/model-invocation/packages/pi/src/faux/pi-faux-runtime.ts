import {
  createModels,
  fauxProvider,
  type Context,
  type StreamOptions,
} from '@earendil-works/pi-ai';
import { type ActorInvocationConfig } from '@print-an-agent/model-invocation-core';
import {
  ModelInvocationError,
  DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY,
  defineProviderModelReference,
} from '@print-an-agent/model-invocation-core';
import { createPiActorEngine, PiActorRuntime } from '../runtime/pi-actor-runtime.js';
import {
  cloneRequestSnapshot,
  createResponseMessage,
  toToolResultSnapshot,
} from './pi-faux-message-mapping.js';
import { toModelMessage } from '../runtime/pi-message-mapping.js';
import type {
  PiFauxRequestSnapshot,
  PiFauxRuntimeInspection,
  PiFauxRuntimeOptions,
  PiFauxRuntimeProfile,
  PiFauxToolEventSnapshot,
} from './types.js';

const DEFAULT_PROVIDER_ID = 'faux';
const DEFAULT_MODEL_ID = 'faux-model';
const DEFAULT_ACTOR_ENGINE_ID = 'deterministic-provider';
const DEFAULT_CHARACTERS_PER_CHUNK = 3;

function validatePositiveNumber(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new ModelInvocationError('MODEL_REFERENCE_INVALID', `${name} must be positive.`);
  }
}

function snapshotFromPiContext(
  context: Context,
  callIndex: number,
  kind: PiFauxRequestSnapshot['kind'],
  invocationConfig: ActorInvocationConfig
): PiFauxRequestSnapshot {
  return Object.freeze({
    kind,
    callIndex,
    instructions: context.systemPrompt ?? '',
    invocationConfig: Object.freeze({ ...invocationConfig }),
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

function invocationConfigFromPiOptions(options: StreamOptions | undefined): ActorInvocationConfig {
  return Object.freeze({
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
  });
}

export function createPiFauxRuntime(options: PiFauxRuntimeOptions): PiFauxRuntimeProfile {
  validatePositiveNumber(options.charactersPerChunk, 'charactersPerChunk');
  validatePositiveNumber(options.tokensPerSecond, 'tokensPerSecond');
  if (options.responses.length === 0) {
    throw new ModelInvocationError(
      'MODEL_REFERENCE_INVALID',
      'Deterministic provider requires at least one response.'
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
  const invocationKinds = new WeakMap<Context, PiFauxRequestSnapshot['kind']>();
  handle.setResponses(
    options.responses.map((definition) => async (context, streamOptions) => {
      const snapshot = snapshotFromPiContext(
        context,
        requests.length + 1,
        invocationKinds.get(context) ?? 'agent-loop',
        invocationConfigFromPiOptions(streamOptions)
      );
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
  const model = models.getModel(modelReference.provider, modelReference.model);
  if (model === undefined) {
    throw new ModelInvocationError(
      'MODEL_RUNTIME_PROTOCOL_INVALID',
      'Deterministic provider did not register its configured model.'
    );
  }
  const runtime = new PiActorRuntime({
    models,
    model,
    modelReference,
    transportLivenessPolicy: DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY,
    hooks: {
      observeInvocation: (context, kind) => invocationKinds.set(context, kind),
      observeToolEvent: (event) => toolEvents.push(Object.freeze({ ...event })),
    },
  });
  const actorEngine = createPiActorEngine(
    runtime,
    options.actorEngineId ?? DEFAULT_ACTOR_ENGINE_ID,
    model.contextWindow
  );

  return Object.freeze({
    runtime,
    modelReference,
    actorEngine,
    inspect(): PiFauxRuntimeInspection {
      return Object.freeze({
        callCount: handle.state.callCount,
        pendingResponseCount: handle.getPendingResponseCount(),
        requests: Object.freeze(requests.map(cloneRequestSnapshot)),
        toolEvents: Object.freeze(toolEvents.map((event) => Object.freeze({ ...event }))),
      });
    },
  });
}
