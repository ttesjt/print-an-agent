import type { AgentTraceEvent, AgentTraceEventDetails } from '../../events/index.js';

export interface AgentTraceEventSink {
  record(event: AgentTraceEvent): Promise<void>;
}

export interface AgentTraceSinkFailure {
  readonly event: AgentTraceEvent;
  readonly cause: unknown;
}

export type AgentTraceSinkFailureReporter = (failure: AgentTraceSinkFailure) => Promise<void>;

export interface AgentTraceEmitter {
  readonly agentId: string;
  readonly agentRunId: string;
  record(details: AgentTraceEventDetails): Promise<void>;
}
