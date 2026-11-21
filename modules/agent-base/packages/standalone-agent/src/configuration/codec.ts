import type { AgentConfigCodec, ConfigValue } from '@print-an-agent/base-identity-config/config';
import { defineStandaloneAgentConfig } from './agent-config.js';
import type { StandaloneAgentConfig, StandaloneAgentConfigInput } from './types/agent.js';

function encodeProviderReference(
  reference: StandaloneAgentConfig['provider']['config']['reference']
): ConfigValue {
  return {
    provider: reference.provider,
    model: reference.model,
    ...(reference.baseUrl === undefined ? {} : { baseUrl: reference.baseUrl }),
    ...(reference.credentialRef === undefined ? {} : { credentialRef: reference.credentialRef }),
  };
}

function encodeProviderConfig(config: StandaloneAgentConfig['provider']['config']): ConfigValue {
  const provider: ConfigValue =
    config.kind === 'builtin'
      ? {
          kind: config.kind,
          reference: encodeProviderReference(config.reference),
        }
      : {
          kind: config.kind,
          reference: encodeProviderReference(config.reference),
          contextWindowTokens: config.contextWindowTokens,
          maxOutputTokens: config.maxOutputTokens,
          supportsReasoning: config.supportsReasoning,
          compatibility: {
            supportsDeveloperRole: config.compatibility.supportsDeveloperRole,
          },
        };
  return provider;
}

export function encodeStandaloneAgentConfig(config: StandaloneAgentConfig): ConfigValue {
  const credential: ConfigValue | undefined =
    config.credential === undefined
      ? undefined
      : {
          reference: config.credential.reference,
          environmentVariable: config.credential.environmentVariable,
        };
  const mainActor: ConfigValue = {
    ...(config.mainActor.instructions === undefined
      ? {}
      : { instructions: config.mainActor.instructions }),
    invocationConfig: {
      ...(config.mainActor.invocationConfig.temperature === undefined
        ? {}
        : { temperature: config.mainActor.invocationConfig.temperature }),
      ...(config.mainActor.invocationConfig.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: config.mainActor.invocationConfig.maxOutputTokens }),
    },
    invocationPolicy: {
      timeoutMilliseconds: config.mainActor.invocationPolicy.timeoutMilliseconds,
    },
  };
  return {
    provider: {
      config: encodeProviderConfig(config.provider.config),
      ...(config.provider.textTokenCounter === undefined
        ? {}
        : { textTokenCounter: { ...config.provider.textTokenCounter } }),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds:
          config.provider.transportLivenessPolicy.responseStartTimeoutMilliseconds,
        streamEventIdleTimeoutMilliseconds:
          config.provider.transportLivenessPolicy.streamEventIdleTimeoutMilliseconds,
      },
    },
    ...(credential === undefined ? {} : { credential }),
    mainActor,
    request: { timeoutMilliseconds: config.request.timeoutMilliseconds },
    sessionCompaction: {
      ...config.sessionCompaction,
      target: { ...config.sessionCompaction.target },
    },
  };
}

export const STANDALONE_AGENT_CONFIG_CODEC: AgentConfigCodec<StandaloneAgentConfig> = Object.freeze(
  {
    schemaVersion: 1,
    decode: (value: unknown) => defineStandaloneAgentConfig(value),
    encode: (config: StandaloneAgentConfigInput) =>
      encodeStandaloneAgentConfig(defineStandaloneAgentConfig(config)),
  }
);
