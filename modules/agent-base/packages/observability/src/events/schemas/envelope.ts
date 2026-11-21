import { positiveTraceCount, traceChoice, traceCount, traceString } from './fields.js';
import type { TraceFieldValues } from './event-schema.js';

export const TRACE_SCHEMA_VERSION = 2;
export const TRACE_ENVELOPE_FIELDS = {
  schemaVersion: traceChoice(TRACE_SCHEMA_VERSION),
  agentId: traceString,
  agentRunId: traceString,
  sequence: positiveTraceCount,
  timestamp: traceCount,
};

export type AgentTraceEnvelope = TraceFieldValues<typeof TRACE_ENVELOPE_FIELDS>;
