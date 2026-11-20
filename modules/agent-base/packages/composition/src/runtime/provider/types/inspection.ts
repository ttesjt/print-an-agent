import type {
  ActorEngineId,
  ProviderId,
  ProviderModelId,
  ProviderTransportLivenessPolicy,
  TokenCounterDescriptor,
} from '@print-an-agent/model-invocation-core';
import type { OpenAICompatibleProviderCompatibility } from './configuration.js';

export interface ProviderRuntimeInspectionBase {
  readonly textTokenCounter?: TokenCounterDescriptor;
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl: string;
  readonly authentication: 'credential-reference' | 'keyless';
  readonly actorEngineId: ActorEngineId;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Resolved non-secret capability used by the provider runtime. */
  readonly supportsReasoning: boolean;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
}

export interface BuiltinProviderRuntimeInspection extends ProviderRuntimeInspectionBase {
  readonly kind: 'builtin';
}

export interface OpenAICompatibleProviderRuntimeInspection extends ProviderRuntimeInspectionBase {
  readonly kind: 'openai-compatible';
  readonly compatibility: OpenAICompatibleProviderCompatibility;
}

export type ProviderRuntimeInspection =
  | BuiltinProviderRuntimeInspection
  | OpenAICompatibleProviderRuntimeInspection;

export type ProviderReadiness =
  | Readonly<{ status: 'ready'; inspection: ProviderRuntimeInspection }>
  | Readonly<{
      status: 'credential-unavailable';
      inspection: ProviderRuntimeInspection;
    }>;
