import type { ActorEngineId } from '@ta-agent/base-actor';
import type {
  ProviderCredentialResolver,
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderModelReferenceInput,
} from '@ta-agent/base-model';

export interface BuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface OpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
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
}

export type DefinedProviderConfig =
  | DefinedBuiltinProviderConfig
  | DefinedOpenAICompatibleProviderConfig;

export interface ProviderRuntimeOptions {
  readonly config: ProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
}

export interface ProviderRuntimeInspection {
  readonly kind: ProviderConfigInput['kind'];
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl: string;
  readonly authentication: 'credential-reference' | 'keyless';
  readonly actorEngineId: ActorEngineId;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export type ProviderReadiness =
  | Readonly<{ status: 'ready'; inspection: ProviderRuntimeInspection }>
  | Readonly<{
      status: 'credential-unavailable';
      inspection: ProviderRuntimeInspection;
    }>;
