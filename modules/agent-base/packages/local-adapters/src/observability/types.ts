import type { AgentTraceEvent } from '@print-an-agent/base-observability';

export interface MemoryAgentTraceAdapterOptions {
  readonly maxEvents: number;
}

export interface AgentTraceInspectionOptions {
  readonly agentRunId?: string;
}

export interface AgentTraceSnapshot {
  readonly events: readonly AgentTraceEvent[];
  readonly droppedEvents: number;
}
