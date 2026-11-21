import type { Api, Model } from '@earendil-works/pi-ai';
import type { TokenCounterDescriptor } from '@print-an-agent/model-invocation-core';
import type { DefinedPiProviderConfig } from './types/configuration.js';
import type { PiProviderRuntimeInspection } from './types/profile.js';

export function createInspection(
  config: DefinedPiProviderConfig,
  model: Model<Api>,
  actorEngineId: PiProviderRuntimeInspection['actorEngineId'],
  transportLivenessPolicy: PiProviderRuntimeInspection['transportLivenessPolicy'],
  textTokenCounter: TokenCounterDescriptor | undefined
): PiProviderRuntimeInspection {
  const common = {
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    provider: config.reference.provider,
    model: config.reference.model,
    baseUrl: model.baseUrl,
    authentication:
      config.reference.credentialRef === undefined ? 'keyless' : 'credential-reference',
    actorEngineId,
    contextWindowTokens: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    supportsReasoning: model.reasoning,
    transportLivenessPolicy,
  } as const;
  return config.kind === 'builtin'
    ? Object.freeze({ kind: config.kind, ...common })
    : Object.freeze({
        kind: config.kind,
        ...common,
        compatibility: config.compatibility,
      });
}
