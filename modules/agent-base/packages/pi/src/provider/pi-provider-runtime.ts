import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type ApiKeyAuth,
  type AuthContext,
  type Model,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { AgentModelError } from '@ta-agent/base-model';
import { createPiActorEngine, PiActorRuntime } from '../runtime/pi-actor-runtime.js';
import {
  definePiProviderConfig,
  type DefinedPiOpenAICompatibleProviderConfig,
  type DefinedPiProviderConfig,
} from './pi-provider-config.js';
import type {
  PiProviderRuntimeInspection,
  PiProviderRuntimeOptions,
  PiProviderRuntimeProfile,
} from './types.js';

const DEFAULT_ACTOR_ENGINE_ID = 'pi-provider';

const NO_AMBIENT_AUTH: AuthContext = Object.freeze({
  env: () => Promise.resolve(undefined),
  fileExists: () => Promise.resolve(false),
});

const KEYLESS_AUTH: ApiKeyAuth = Object.freeze({
  name: 'Keyless local endpoint',
  resolve: () =>
    Promise.resolve(
      Object.freeze({
        auth: Object.freeze({
          apiKey: 'unused',
          headers: Object.freeze({ Authorization: null }),
        }),
        source: 'keyless',
      })
    ),
});

function createBuiltinModels(config: DefinedPiProviderConfig): {
  readonly models: ReturnType<typeof builtinModels>;
  readonly model: Model<Api>;
} {
  const models = builtinModels({ authContext: NO_AMBIENT_AUTH });
  const provider = models.getProvider(config.reference.provider);
  if (provider === undefined) {
    throw new AgentModelError(
      'MODEL_PROVIDER_NOT_FOUND',
      `Pi builtin provider "${config.reference.provider}" was not found.`
    );
  }
  const catalogModel = models.getModel(config.reference.provider, config.reference.model);
  if (catalogModel === undefined) {
    throw new AgentModelError(
      'MODEL_TARGET_NOT_FOUND',
      `Pi builtin model "${config.reference.provider}/${config.reference.model}" was not found.`
    );
  }
  const model = Object.freeze({
    ...catalogModel,
    ...(config.reference.baseUrl === undefined ? {} : { baseUrl: config.reference.baseUrl }),
  });
  return Object.freeze({ models, model });
}

function createOpenAICompatibleModels(config: DefinedPiOpenAICompatibleProviderConfig): {
  readonly models: ReturnType<typeof createModels>;
  readonly model: Model<'openai-completions'>;
} {
  const inputMediaTypes: Array<'text' | 'image'> = ['text'];
  const model: Model<'openai-completions'> = Object.freeze({
    id: config.reference.model,
    name: config.reference.model,
    api: 'openai-completions',
    provider: config.reference.provider,
    baseUrl: config.reference.baseUrl,
    reasoning: false,
    input: inputMediaTypes,
    cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    contextWindow: config.contextWindowTokens,
    maxTokens: config.maxOutputTokens,
  });
  const models = createModels({ authContext: NO_AMBIENT_AUTH });
  models.setProvider(
    createProvider({
      id: config.reference.provider,
      auth: {
        apiKey:
          config.reference.credentialRef === undefined
            ? KEYLESS_AUTH
            : envApiKeyAuth('API key', Object.freeze([])),
      },
      models: Object.freeze([model]),
      api: openAICompletionsApi(),
    })
  );
  return Object.freeze({ models, model });
}

function resolveModels(config: DefinedPiProviderConfig) {
  return config.kind === 'builtin'
    ? createBuiltinModels(config)
    : createOpenAICompatibleModels(config);
}

function createInspection(
  config: DefinedPiProviderConfig,
  model: Model<Api>,
  actorEngineId: PiProviderRuntimeInspection['actorEngineId']
): PiProviderRuntimeInspection {
  return Object.freeze({
    kind: config.kind,
    provider: config.reference.provider,
    model: config.reference.model,
    baseUrl: model.baseUrl,
    authentication:
      config.reference.credentialRef === undefined ? 'keyless' : 'credential-reference',
    actorEngineId,
    contextWindowTokens: model.contextWindow,
    maxOutputTokens: model.maxTokens,
  });
}

export function createPiProviderRuntime(
  options: PiProviderRuntimeOptions
): PiProviderRuntimeProfile {
  const config = definePiProviderConfig(options.provider);
  const { models, model } = resolveModels(config);
  const runtime = new PiActorRuntime({
    models,
    model,
    modelReference: config.reference,
    ...(options.credentialResolver === undefined
      ? {}
      : { credentialResolver: options.credentialResolver }),
  });
  const actorEngine = createPiActorEngine(
    runtime,
    options.actorEngineId ?? DEFAULT_ACTOR_ENGINE_ID,
    model.contextWindow
  );
  const inspection = createInspection(config, model, actorEngine.id);

  return Object.freeze({
    runtime,
    modelReference: config.reference,
    actorEngine,
    inspect: () => inspection,
    checkReadiness: async (readinessOptions?: Readonly<{ signal?: AbortSignal }>) => {
      const signal = readinessOptions?.signal ?? new AbortController().signal;
      const status = await runtime.checkCredential(signal);
      return Object.freeze({ status, inspection });
    },
  });
}
