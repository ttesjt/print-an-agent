import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type ApiKeyAuth,
  type AuthContext,
  type Model,
  type Models,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import type {
  DefinedPiProviderConfig,
  DefinedPiOpenAICompatibleProviderConfig,
} from './types/configuration.js';

interface PiModelBinding {
  readonly models: Models;
  readonly model: Model<Api>;
}

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
    throw new ModelInvocationError(
      'MODEL_PROVIDER_NOT_FOUND',
      `Builtin provider "${config.reference.provider}" was not found.`
    );
  }
  const catalogModel = models.getModel(config.reference.provider, config.reference.model);
  if (catalogModel === undefined) {
    throw new ModelInvocationError(
      'MODEL_TARGET_NOT_FOUND',
      `Builtin model "${config.reference.provider}/${config.reference.model}" was not found.`
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
    reasoning: config.supportsReasoning,
    compat: Object.freeze({
      supportsDeveloperRole: config.compatibility.supportsDeveloperRole,
    }),
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

export function resolvePiModels(config: DefinedPiProviderConfig): PiModelBinding {
  return config.kind === 'builtin'
    ? createBuiltinModels(config)
    : createOpenAICompatibleModels(config);
}
