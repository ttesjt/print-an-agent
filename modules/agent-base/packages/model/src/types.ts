import type { ToolRuntime } from '@ta-agent/base-tool';

declare const providerIdBrand: unique symbol;
declare const providerModelIdBrand: unique symbol;
declare const providerCredentialReferenceBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: 'ProviderId' };
export type ProviderModelId = string & { readonly [providerModelIdBrand]: 'ProviderModelId' };
export type ProviderCredentialReference = string & {
  readonly [providerCredentialReferenceBrand]: 'ProviderCredentialReference';
};

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

export interface AssistantModelMessage {
  readonly role: 'assistant';
  readonly text: string;
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
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

export type AgentLoopEvent =
  | Readonly<{ type: 'interaction-start' }>
  | Readonly<{ type: 'turn-start' }>
  | Readonly<{ type: 'text-delta'; delta: string }>
  | Readonly<{ type: 'tool-call-start'; callId: string; toolName: string }>
  | Readonly<{
      type: 'tool-call-end';
      callId: string;
      toolName: string;
      status: 'success' | 'error';
      resultCharacters: number;
    }>
  | Readonly<{ type: 'assistant-complete'; message: AssistantModelMessage }>
  | Readonly<{ type: 'turn-end' }>
  | Readonly<{ type: 'interaction-end' }>;

export type AgentLoopEventSink = (event: AgentLoopEvent) => Promise<void>;

export interface AgentLoopRequest {
  readonly target: ResolvedExecutionTarget;
  readonly instructions: string;
  readonly history: readonly ModelMessage[];
  readonly prompt: UserModelMessage;
  readonly tools: ToolRuntime;
  readonly maxProviderTurns: number;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly emit: AgentLoopEventSink;
}

export interface AgentLoopResult {
  readonly message: AssistantModelMessage;
}

export interface AgentLoopRuntime {
  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget>;
  run(request: AgentLoopRequest): Promise<AgentLoopResult>;
}
