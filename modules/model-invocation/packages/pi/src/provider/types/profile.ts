import type {
  ActorEngine,
  ActorEngineId,
  TokenCounter,
  TextTokenInput,
  TokenCounterDescriptor,
  ModelInteractionRuntime,
  ProviderCredentialResolver,
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@print-an-agent/model-invocation-core';
import type {
  PiProviderConfigInput,
  PiOpenAICompatibleProviderCompatibility,
} from './configuration.js';

export interface PiProviderRuntimeOptions {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly provider: PiProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
  /** Optional provider transport liveness; omission adds no Agent Base transport deadline. */
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}

export interface PiProviderRuntimeInspectionBase {
  readonly textTokenCounter?: TokenCounterDescriptor;
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl: string;
  readonly authentication: 'credential-reference' | 'keyless';
  readonly actorEngineId: ActorEngineId;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Resolved non-secret capability used by the Pi model boundary. */
  readonly supportsReasoning: boolean;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
}

export interface PiBuiltinProviderRuntimeInspection extends PiProviderRuntimeInspectionBase {
  readonly kind: 'builtin';
}

export interface PiOpenAICompatibleProviderRuntimeInspection extends PiProviderRuntimeInspectionBase {
  readonly kind: 'openai-compatible';
  readonly compatibility: PiOpenAICompatibleProviderCompatibility;
}

export type PiProviderRuntimeInspection =
  | PiBuiltinProviderRuntimeInspection
  | PiOpenAICompatibleProviderRuntimeInspection;

export type PiProviderReadiness =
  | Readonly<{ status: 'ready'; inspection: PiProviderRuntimeInspection }>
  | Readonly<{ status: 'credential-unavailable'; inspection: PiProviderRuntimeInspection }>;

export interface PiProviderRuntimeProfile {
  readonly runtime: ModelInteractionRuntime;
  readonly modelReference: ProviderModelReference;
  readonly actorEngine: ActorEngine;
  inspect(): PiProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<PiProviderReadiness>;
}
