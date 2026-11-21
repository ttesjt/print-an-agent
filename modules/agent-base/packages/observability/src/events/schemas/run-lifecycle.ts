import { traceEvent, type TraceEventDetailsOf } from './event-schema.js';
import { traceString, traceStructuredErrorCode, WORKFLOW_REFERENCE_FIELDS } from './fields.js';

const operation = { operationName: traceString };
const step = { ...WORKFLOW_REFERENCE_FIELDS, stepName: traceString };

export const RUN_LIFECYCLE_SCHEMAS = [
  traceEvent('agent-run-started', operation, { parentRunId: traceString }),
  traceEvent('agent-run-completed', operation),
  traceEvent('agent-run-failed', { ...operation, errorCode: traceStructuredErrorCode }),
  traceEvent('workflow-run-started', WORKFLOW_REFERENCE_FIELDS),
  traceEvent('workflow-run-skipped', WORKFLOW_REFERENCE_FIELDS),
  traceEvent('workflow-run-completed', WORKFLOW_REFERENCE_FIELDS),
  traceEvent('workflow-run-failed', {
    ...WORKFLOW_REFERENCE_FIELDS,
    errorCode: traceStructuredErrorCode,
  }),
  traceEvent('step-started', step),
  traceEvent('step-skipped', step),
  traceEvent('step-completed', step),
  traceEvent('step-failed', { ...step, errorCode: traceStructuredErrorCode }),
] as const;

export type RunLifecycleTrace = TraceEventDetailsOf<(typeof RUN_LIFECYCLE_SCHEMAS)[number]>;
