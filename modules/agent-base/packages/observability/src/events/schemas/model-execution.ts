import { traceEvent, type TraceEventDetailsOf } from './event-schema.js';
import {
  positiveTraceCount,
  traceChoice,
  traceCount,
  traceProvenanceType,
  traceString,
  traceStructuredErrorCode,
  WORKFLOW_REFERENCE_FIELDS,
} from './fields.js';

const modelTurn = { ...WORKFLOW_REFERENCE_FIELDS, modelTurnIndex: positiveTraceCount };
const toolCall = { ...WORKFLOW_REFERENCE_FIELDS, callId: traceString, toolName: traceString };
const loopSummary = {
  ...WORKFLOW_REFERENCE_FIELDS,
  modelTurns: traceCount,
  toolCalls: traceCount,
  totalToolResultCharacters: traceCount,
};
const modelResponse = {
  ...modelTurn,
  engineId: traceString,
  stopReason: traceChoice('stop', 'length'),
  inputTokens: traceCount,
  outputTokens: traceCount,
  cacheReadTokens: traceCount,
  cacheWriteTokens: traceCount,
  totalTokens: traceCount,
  outputCharacters: traceCount,
};

export const MODEL_EXECUTION_SCHEMAS = [
  traceEvent('agent-loop-started', {
    ...WORKFLOW_REFERENCE_FIELDS,
    sessionId: traceString,
    maxModelTurns: positiveTraceCount,
    maxOutputCharacters: positiveTraceCount,
  }),
  traceEvent('agent-loop-completed', loopSummary),
  traceEvent('agent-loop-failed', { ...loopSummary, errorCode: traceStructuredErrorCode }),
  traceEvent('model-turn-started', modelTurn),
  traceEvent('model-turn-completed', modelTurn),
  traceEvent('tool-call-started', toolCall),
  traceEvent('tool-call-completed', {
    ...toolCall,
    status: traceChoice('success', 'error'),
    resultCharacters: traceCount,
  }),
  traceEvent('model-response-completed', {
    ...modelResponse,
    provenanceKind: traceChoice('provider-model'),
    provider: traceString,
    model: traceString,
  }),
  traceEvent('model-response-completed', {
    ...modelResponse,
    provenanceKind: traceChoice('engine-defined'),
    provenanceType: traceProvenanceType,
  }),
] as const;

export type ModelExecutionTrace = TraceEventDetailsOf<(typeof MODEL_EXECUTION_SCHEMAS)[number]>;
