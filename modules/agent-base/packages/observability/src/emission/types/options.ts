import type { AgentTraceEventSink, AgentTraceSinkFailureReporter } from './ports.js';

export interface AgentTraceRuntimeOptions {
  readonly sink?: AgentTraceEventSink;
  readonly clock?: () => number;
  readonly onSinkFailure?: AgentTraceSinkFailureReporter;
}

export interface CreateAgentTraceEmitterOptions extends AgentTraceRuntimeOptions {
  readonly agentId: string;
  readonly agentRunId: string;
}
