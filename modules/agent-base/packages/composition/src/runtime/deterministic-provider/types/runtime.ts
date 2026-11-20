import type { ActorInvocationConfig, ModelMessage } from '@print-an-agent/model-invocation-core';

export interface DeterministicProviderRequestSnapshot {
  readonly kind: 'agent-loop' | 'direct' | 'stream';
  readonly callIndex: number;
  readonly instructions: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly messages: readonly ModelMessage[];
  readonly toolResults: readonly DeterministicProviderToolResultSnapshot[];
}

export interface DeterministicProviderToolResultSnapshot {
  readonly callId: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
}

export type DeterministicProviderToolEventSnapshot =
  | Readonly<{ type: 'tool-call-start'; callId: string; toolName: string }>
  | Readonly<{
      type: 'tool-call-end';
      callId: string;
      toolName: string;
      status: 'success' | 'error';
      resultCharacters: number;
    }>;

export type DeterministicProviderResponse = Readonly<{ reasoning?: string }> &
  (
    | Readonly<{ status: 'success'; text: string; stopReason?: 'stop' | 'length' }>
    | Readonly<{ status: 'failure'; message: string; partialText?: string }>
    | Readonly<{
        status: 'tool-call';
        name: string;
        callId?: string;
        text?: string;
        arguments?: Readonly<Record<string, unknown>>;
      }>
  );

export type DeterministicProviderResponseFactory = (
  request: DeterministicProviderRequestSnapshot
) => DeterministicProviderResponse | Promise<DeterministicProviderResponse>;

export interface DeterministicProviderRuntimeOptions {
  readonly responses: readonly (
    | DeterministicProviderResponse
    | DeterministicProviderResponseFactory
  )[];
  readonly providerId?: string;
  readonly modelId?: string;
  readonly charactersPerChunk?: number;
  readonly tokensPerSecond?: number;
  readonly actorEngineId?: string;
}

export interface DeterministicProviderInspection {
  readonly callCount: number;
  readonly pendingResponseCount: number;
  readonly requests: readonly DeterministicProviderRequestSnapshot[];
  readonly toolEvents: readonly DeterministicProviderToolEventSnapshot[];
}
