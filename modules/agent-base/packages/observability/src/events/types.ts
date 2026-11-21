import type { AgentTraceEnvelope } from './schemas/envelope.js';
import type { RunLifecycleTrace } from './schemas/run-lifecycle.js';
import type { SessionTrace } from './schemas/session.js';
import type { RequestTrace } from './schemas/request.js';
import type { ModelExecutionTrace } from './schemas/model-execution.js';

export type AgentTraceEventDetails =
  | RunLifecycleTrace
  | SessionTrace
  | RequestTrace
  | ModelExecutionTrace;

type WithTraceEnvelope<Details> = Details extends AgentTraceEventDetails
  ? Readonly<Details & AgentTraceEnvelope>
  : never;

export type AgentTraceEvent = WithTraceEnvelope<AgentTraceEventDetails>;
