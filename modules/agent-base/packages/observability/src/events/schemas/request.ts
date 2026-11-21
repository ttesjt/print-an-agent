import { traceEvent, type TraceEventDetailsOf } from './event-schema.js';
import {
  positiveTraceCount,
  traceBoolean,
  traceChoice,
  traceCount,
  traceString,
  traceStructuredErrorCode,
  WORKFLOW_REFERENCE_FIELDS,
} from './fields.js';

const replayStatus = traceChoice('claimed', 'completed', 'active', 'failed', 'conflict');
const publicationStage = traceChoice('open', 'write', 'close');
export type RequestReplayTraceStatus = ReturnType<typeof replayStatus>;
export type OutputPublicationStage = ReturnType<typeof publicationStage>;

const publication = {
  ...WORKFLOW_REFERENCE_FIELDS,
  sessionId: traceString,
  replayed: traceBoolean,
};

export const REQUEST_TRACE_SCHEMAS = [
  traceEvent('request-replay-resolved', {
    ...WORKFLOW_REFERENCE_FIELDS,
    sessionId: traceString,
    status: replayStatus,
  }),
  traceEvent('actor-resolved', {
    ...WORKFLOW_REFERENCE_FIELDS,
    responsibilityId: traceString,
    responsibilityRevision: positiveTraceCount,
    actorId: traceString,
    actorRevision: positiveTraceCount,
    engineId: traceString,
    candidateIndex: traceCount,
    invocationMode: traceChoice('interaction', 'direct'),
  }),
  traceEvent('tools-resolved', {
    ...WORKFLOW_REFERENCE_FIELDS,
    effectiveToolCount: traceCount,
    maxToolCalls: traceCount,
    maxArgumentCharacters: traceCount,
    maxResultCharacters: traceCount,
    maxTotalResultCharacters: traceCount,
    toolTimeoutMilliseconds: traceCount,
  }),
  traceEvent('output-publication-started', publication),
  traceEvent('output-publication-completed', { ...publication, outputCharacters: traceCount }),
  traceEvent('output-publication-failed', {
    ...publication,
    stage: publicationStage,
    errorCode: traceStructuredErrorCode,
  }),
] as const;

export type RequestTrace = TraceEventDetailsOf<(typeof REQUEST_TRACE_SCHEMAS)[number]>;
