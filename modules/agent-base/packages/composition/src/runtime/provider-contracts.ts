import type {
  ActorEngineId,
  TokenCounter,
  TextTokenInput,
  TokenCounterDescriptor,
} from '@ta-agent/model-invocation-core';
import type {
  ProviderCredentialResolver,
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderModelReferenceInput,
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@ta-agent/model-invocation-core';

export interface BuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface OpenAICompatibleProviderCompatibility {
  /** Whether the endpoint accepts OpenAI's developer message role for instructions. */
  readonly supportsDeveloperRole: boolean;
}

export interface OpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: OpenAICompatibleProviderCompatibility;
}

export type ProviderConfigInput = BuiltinProviderConfigInput | OpenAICompatibleProviderConfigInput;

export interface DefinedBuiltinProviderConfig {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReference;
}

export interface DefinedOpenAICompatibleProviderConfig {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReference & Readonly<{ baseUrl: string }>;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: OpenAICompatibleProviderCompatibility;
}

export type DefinedProviderConfig =
  | DefinedBuiltinProviderConfig
  | DefinedOpenAICompatibleProviderConfig;

export interface ProviderRuntimeOptions {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly config: ProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
  /** Optional provider transport liveness; omission adds no Agent Base transport deadline. */
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}

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
