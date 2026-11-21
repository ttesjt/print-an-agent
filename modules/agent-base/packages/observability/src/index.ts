export { createAgentTraceEmitter, NOOP_AGENT_TRACE_SINK } from './emission/index.js';
export type {
  AgentTraceEmitter,
  AgentTraceEventSink,
  AgentTraceSinkFailure,
  AgentTraceSinkFailureReporter,
  AgentTraceRuntimeOptions,
  CreateAgentTraceEmitterOptions,
} from './emission/index.js';
export { AgentObservabilityError } from './errors.js';
export type { AgentObservabilityErrorCode } from './errors.js';
export {
  traceErrorCode,
  validateAgentTraceEvent,
  validateAgentTraceEventDetails,
} from './events/index.js';
export type {
  AgentTraceEnvelope,
  AgentTraceEvent,
  AgentTraceEventDetails,
  RequestReplayTraceStatus,
  OutputPublicationStage,
} from './events/index.js';
