import { isProxy } from 'node:util/types';
import { AgentObservabilityError, invalidTraceEvent } from '../errors.js';
import { snapshotMetadataRecord } from './metadata-record.js';
import { validateTraceEventSchema, type TraceFields } from './schemas/event-schema.js';
import { TRACE_ENVELOPE_FIELDS } from './schemas/envelope.js';
import { MODEL_EXECUTION_SCHEMAS } from './schemas/model-execution.js';
import { REQUEST_TRACE_SCHEMAS } from './schemas/request.js';
import { RUN_LIFECYCLE_SCHEMAS } from './schemas/run-lifecycle.js';
import { SESSION_TRACE_SCHEMAS } from './schemas/session.js';
import type { AgentTraceEvent, AgentTraceEventDetails } from './types.js';

const EVENT_SCHEMAS = [
  ...RUN_LIFECYCLE_SCHEMAS,
  ...SESSION_TRACE_SCHEMAS,
  ...REQUEST_TRACE_SCHEMAS,
  ...MODEL_EXECUTION_SCHEMAS,
];

function validateRecord(value: unknown, envelopeFields: TraceFields): void {
  // Assertions narrow the original object; a Proxy can disagree with its data descriptors.
  if (isProxy(value)) invalidTraceEvent('Trace validation does not accept Proxy inputs.');
  const record = snapshotMetadataRecord(value);
  if (!Object.hasOwn(record, 'type')) invalidTraceEvent('Trace event type is required.');
  const candidates = EVENT_SCHEMAS.filter((schema) => schema.type === record.type);
  if (candidates.length === 0) invalidTraceEvent('Trace event type is not supported.');
  for (const [index, schema] of candidates.entries()) {
    try {
      validateTraceEventSchema(record, schema, envelopeFields);
      return;
    } catch (error: unknown) {
      // The two model-response provenance variants share one event type, with closed field sets.
      if (
        !(error instanceof AgentObservabilityError) ||
        error.code !== 'TRACE_EVENT_INVALID' ||
        index === candidates.length - 1
      ) {
        throw error;
      }
    }
  }
}

export function validateAgentTraceEventDetails(
  value: unknown
): asserts value is AgentTraceEventDetails {
  validateRecord(value, {});
}

export function validateAgentTraceEvent(value: unknown): asserts value is AgentTraceEvent {
  validateRecord(value, TRACE_ENVELOPE_FIELDS);
}

/** Capture caller metadata before injected clocks or queued sink writes can change it. */
export function snapshotAgentTraceEventDetails(value: unknown): AgentTraceEventDetails {
  const snapshot = snapshotMetadataRecord(value);
  validateAgentTraceEventDetails(snapshot);
  return snapshot;
}
