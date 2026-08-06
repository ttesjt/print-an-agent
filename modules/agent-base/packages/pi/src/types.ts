import type { AgentLoopRuntime, ModelMessage, ProviderModelReference } from '@ta-agent/base-model';

export interface PiFauxRequestSnapshot {
  readonly callIndex: number;
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
}

export type PiFauxResponse =
  | Readonly<{ status: 'success'; text: string; stopReason?: 'stop' | 'length' }>
  | Readonly<{ status: 'failure'; message: string; partialText?: string }>
  | Readonly<{
      status: 'tool-call';
      name: string;
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
}

export interface PiFauxRuntimeInspection {
  readonly callCount: number;
  readonly pendingResponseCount: number;
  readonly requests: readonly PiFauxRequestSnapshot[];
}

export interface PiFauxRuntimeProfile {
  readonly runtime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  inspect(): PiFauxRuntimeInspection;
}
