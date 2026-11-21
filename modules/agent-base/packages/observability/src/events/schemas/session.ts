import { traceEvent, type TraceEventDetailsOf } from './event-schema.js';
import { traceChoice, traceCount, traceString, WORKFLOW_REFERENCE_FIELDS } from './fields.js';

export const SESSION_TRACE_SCHEMAS = [
  traceEvent('session-resolved', {
    ...WORKFLOW_REFERENCE_FIELDS,
    sessionId: traceString,
    branchId: traceString,
    navigationRevision: traceCount,
  }),
  traceEvent('session-navigation-applied', {
    ...WORKFLOW_REFERENCE_FIELDS,
    operation: traceChoice('select', 'fork', 'rewind'),
    sessionId: traceString,
    selectedBranchId: traceString,
    affectedBranchId: traceString,
    navigationRevision: traceCount,
  }),
] as const;

export type SessionTrace = TraceEventDetailsOf<(typeof SESSION_TRACE_SCHEMAS)[number]>;
