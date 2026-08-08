import type { ActorEngine, ActorInvocationConfig } from '@ta-agent/base-actor';
import type { AgentLoopRuntime, ModelMessage, ProviderModelReference } from '@ta-agent/base-model';

export interface PiFauxRequestSnapshot {
  readonly kind: 'agent-loop' | 'direct';
  readonly callIndex: number;
  readonly instructions: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly messages: readonly ModelMessage[];
  readonly toolResults: readonly PiFauxToolResultSnapshot[];
}

export interface PiFauxToolResultSnapshot {
  readonly callId: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
}

export type PiFauxToolEventSnapshot =
  | Readonly<{ type: 'tool-call-start'; callId: string; toolName: string }>
  | Readonly<{
      type: 'tool-call-end';
      callId: string;
      toolName: string;
      status: 'success' | 'error';
      resultCharacters: number;
    }>;

export type PiFauxResponse =
  | Readonly<{ status: 'success'; text: string; stopReason?: 'stop' | 'length' }>
  | Readonly<{ status: 'failure'; message: string; partialText?: string }>
  | Readonly<{
      status: 'tool-call';
      name: string;
      callId?: string;
      text?: string;
      arguments?: Readonly<Record<string, unknown>>;
    }>;

export type PiFauxResponseFactory = (
  request: PiFauxRequestSnapshot
) => PiFauxResponse | Promise<PiFauxResponse>;

export interface PiFauxRuntimeOptions {
  readonly responses: readonly (PiFauxResponse | PiFauxResponseFactory)[];
  readonly providerId?: string;
  readonly modelId?: string;
  readonly charactersPerChunk?: number;
  readonly tokensPerSecond?: number;
  readonly actorEngineId?: string;
}

export interface PiFauxRuntimeInspection {
  readonly callCount: number;
  readonly pendingResponseCount: number;
  readonly requests: readonly PiFauxRequestSnapshot[];
  readonly toolEvents: readonly PiFauxToolEventSnapshot[];
}

export interface PiFauxRuntimeProfile {
  readonly runtime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly actorEngine: ActorEngine;
  inspect(): PiFauxRuntimeInspection;
}
