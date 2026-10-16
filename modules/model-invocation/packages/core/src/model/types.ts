import type { InteractionTools } from './tools.js';

declare const providerIdBrand: unique symbol;
declare const providerModelIdBrand: unique symbol;
declare const providerCredentialReferenceBrand: unique symbol;
declare const modelExecutionProvenanceTypeBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: 'ProviderId' };
export type ProviderModelId = string & { readonly [providerModelIdBrand]: 'ProviderModelId' };
export type ProviderCredentialReference = string & {
  readonly [providerCredentialReferenceBrand]: 'ProviderCredentialReference';
};
export type ModelExecutionProvenanceType = string & {
  readonly [modelExecutionProvenanceTypeBrand]: 'ModelExecutionProvenanceType';
};

export type ModelExecutionEvidenceValue =
  | null
  | string
  | number
  | boolean
  | readonly ModelExecutionEvidenceValue[]
  | Readonly<{ [key: string]: ModelExecutionEvidenceValue }>;

export type ModelExecutionEvidence = Readonly<{
  [key: string]: ModelExecutionEvidenceValue;
}>;

export interface ProviderModelReferenceInput {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialRef?: string;
}

export interface ProviderModelReference {
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
  readonly baseUrl?: string;
  readonly credentialRef?: ProviderCredentialReference;
}

export interface ProviderApiKeyCredential {
  readonly type: 'api-key';
  readonly apiKey: string;
}

export interface ProviderCredentialResolutionRequest {
  readonly reference: ProviderCredentialReference;
  readonly provider: ProviderId;
  readonly signal: AbortSignal;
}

export interface ProviderCredentialResolver {
  resolve(
    request: ProviderCredentialResolutionRequest
  ): Promise<ProviderApiKeyCredential | undefined>;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
}

export interface UserModelMessage {
  readonly role: 'user';
  readonly text: string;
  readonly timestamp: number;
}

export interface ProviderModelExecutionProvenance {
  readonly kind: 'provider-model';
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
}

export interface EngineDefinedModelExecutionProvenance {
  readonly kind: 'engine-defined';
  readonly type: ModelExecutionProvenanceType;
  readonly evidence: ModelExecutionEvidence;
}

export type ModelExecutionProvenance =
  | ProviderModelExecutionProvenance
  | EngineDefinedModelExecutionProvenance;

export interface AssistantModelMessage {
  readonly role: 'assistant';
  readonly text: string;
  readonly provenance: ModelExecutionProvenance;
  readonly stopReason: 'stop' | 'length';
  readonly usage: ModelUsage;
  readonly timestamp: number;
}

export interface ContextModelMessage {
  readonly role: 'context';
  readonly text: string;
  readonly timestamp: number;
}

export type ModelMessage = UserModelMessage | AssistantModelMessage | ContextModelMessage;

export interface ExecutionTargetCapabilities {
  readonly streaming: true;
  readonly tools: boolean;
}

export interface ResolvedExecutionTarget {
  readonly reference: ProviderModelReference;
  readonly capabilities: ExecutionTargetCapabilities;
}

export interface TextDeltaEvent {
  readonly type: 'text-delta';
  readonly delta: string;
}

/** Provider/Engine-exposed readable reasoning, never an opaque signature or encrypted payload. */
export interface ReasoningDeltaEvent {
  readonly type: 'reasoning-delta';
  readonly delta: string;
}

export interface AssistantCompleteEvent {
  readonly type: 'assistant-complete';
  readonly message: AssistantModelMessage;
}

export type ModelGenerationEvent = TextDeltaEvent | ReasoningDeltaEvent | AssistantCompleteEvent;
export type ModelGenerationEventSink = (event: ModelGenerationEvent) => Promise<void>;

export type ModelInteractionEvent =
  | ModelGenerationEvent
  | Readonly<{ type: 'interaction-start' }>
  | Readonly<{ type: 'turn-start' }>
  | Readonly<{ type: 'tool-call-start'; callId: string; toolName: string }>
  | Readonly<{
      type: 'tool-call-end';
      callId: string;
      toolName: string;
      status: 'success' | 'error';
      resultCharacters: number;
    }>
  | Readonly<{ type: 'turn-end' }>
  | Readonly<{ type: 'interaction-end' }>;

export type ModelInteractionEventSink = (event: ModelInteractionEvent) => Promise<void>;

export interface ModelInteractionRequest {
  readonly target: ResolvedExecutionTarget;
  readonly instructions: string;
  readonly history: readonly ModelMessage[];
  readonly prompt: UserModelMessage;
  readonly tools: InteractionTools;
  readonly maxModelTurns: number;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly emit: ModelInteractionEventSink;
}

export interface ModelInteractionResult {
  readonly message: AssistantModelMessage;
}

export interface ModelInteractionRuntime {
  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget>;
  run(request: ModelInteractionRequest): Promise<ModelInteractionResult>;
}
