import type { ActorEngine, ActorEngineId } from '@ta-agent/model-invocation-core';
import type {
  ModelInteractionRuntime,
  ProviderCredentialResolver,
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderModelReferenceInput,
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@ta-agent/model-invocation-core';

export interface PiBuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface PiOpenAICompatibleProviderCompatibility {
  /** Whether the endpoint accepts OpenAI's developer message role for instructions. */
  readonly supportsDeveloperRole: boolean;
}

export interface PiOpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Declares endpoint capability; it does not request reasoning generation. */
  readonly supportsReasoning: boolean;
  readonly compatibility: PiOpenAICompatibleProviderCompatibility;
}

export type PiProviderConfigInput =
  | PiBuiltinProviderConfigInput
  | PiOpenAICompatibleProviderConfigInput;

export interface PiProviderRuntimeOptions {
  readonly provider: PiProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
  /** Optional provider transport liveness; omission adds no Agent Base transport deadline. */
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}

export interface PiProviderRuntimeInspectionBase {
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
