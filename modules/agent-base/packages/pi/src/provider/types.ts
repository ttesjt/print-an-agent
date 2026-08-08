import type { ActorEngine, ActorEngineId } from '@ta-agent/base-actor';
import type {
  AgentLoopRuntime,
  ProviderCredentialResolver,
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderModelReferenceInput,
} from '@ta-agent/base-model';

export interface PiBuiltinProviderConfigInput {
  readonly kind: 'builtin';
  readonly reference: ProviderModelReferenceInput;
}

export interface PiOpenAICompatibleProviderConfigInput {
  readonly kind: 'openai-compatible';
  readonly reference: ProviderModelReferenceInput;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export type PiProviderConfigInput =
  | PiBuiltinProviderConfigInput
  | PiOpenAICompatibleProviderConfigInput;

export interface PiProviderRuntimeOptions {
  readonly provider: PiProviderConfigInput;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly actorEngineId?: string;
}

export interface PiProviderRuntimeInspection {
  readonly kind: PiProviderConfigInput['kind'];
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl: string;
  readonly authentication: 'credential-reference' | 'keyless';
  readonly actorEngineId: ActorEngineId;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

export type PiProviderReadiness =
  | Readonly<{ status: 'ready'; inspection: PiProviderRuntimeInspection }>
  | Readonly<{ status: 'credential-unavailable'; inspection: PiProviderRuntimeInspection }>;

export interface PiProviderRuntimeProfile {
  readonly runtime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly actorEngine: ActorEngine;
  inspect(): PiProviderRuntimeInspection;
  checkReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<PiProviderReadiness>;
}
