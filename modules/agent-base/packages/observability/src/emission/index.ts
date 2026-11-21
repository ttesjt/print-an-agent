export { createAgentTraceEmitter, NOOP_AGENT_TRACE_SINK } from './emitter.js';
export type {
  AgentTraceEmitter,
  AgentTraceEventSink,
  AgentTraceSinkFailure,
  AgentTraceSinkFailureReporter,
} from './types/ports.js';
export type { AgentTraceRuntimeOptions, CreateAgentTraceEmitterOptions } from './types/options.js';
