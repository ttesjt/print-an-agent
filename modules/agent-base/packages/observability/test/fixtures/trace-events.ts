import type { AgentTraceEventDetails } from '../../src/index.js';

const workflow = { workflowName: 'request', workflowRunId: 'workflow-run' };
const step = { ...workflow, stepName: 'resolve-session' };
const publication = { ...workflow, sessionId: 'session', replayed: false };
const modelResponse = {
  ...workflow,
  modelTurnIndex: 1,
  engineId: 'engine',
  stopReason: 'stop',
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
  outputCharacters: 4,
} as const;

/** Independent examples cover every public discriminant, including both provenance variants. */
export const TRACE_EVENT_EXAMPLES = [
  { type: 'agent-run-started', operationName: 'foreground' },
  { type: 'agent-run-started', operationName: 'foreground', parentRunId: 'parent' },
  { type: 'agent-run-completed', operationName: 'foreground' },
  { type: 'agent-run-failed', operationName: 'foreground', errorCode: 'OPERATION_FAILED' },
  { type: 'workflow-run-started', ...workflow },
  { type: 'workflow-run-skipped', ...workflow },
  { type: 'workflow-run-completed', ...workflow },
  { type: 'workflow-run-failed', ...workflow, errorCode: 'WORKFLOW_FAILED' },
  { type: 'step-started', ...step },
  { type: 'step-skipped', ...step },
  { type: 'step-completed', ...step },
  { type: 'step-failed', ...step, errorCode: 'STEP_FAILED' },
  {
    type: 'session-resolved',
    ...workflow,
    sessionId: 'session',
    branchId: 'branch',
    navigationRevision: 0,
  },
  {
    type: 'session-navigation-applied',
    ...workflow,
    operation: 'fork',
    sessionId: 'session',
    selectedBranchId: 'branch',
    affectedBranchId: 'new-branch',
    navigationRevision: 1,
  },
  { type: 'request-replay-resolved', ...workflow, sessionId: 'session', status: 'claimed' },
  {
    type: 'actor-resolved',
    ...workflow,
    responsibilityId: 'interaction',
    responsibilityRevision: 1,
    actorId: 'actor',
    actorRevision: 1,
    engineId: 'engine',
    candidateIndex: 0,
    invocationMode: 'interaction',
  },
  {
    type: 'tools-resolved',
    ...workflow,
    effectiveToolCount: 0,
    maxToolCalls: 0,
    maxArgumentCharacters: 0,
    maxResultCharacters: 0,
    maxTotalResultCharacters: 0,
    toolTimeoutMilliseconds: 0,
  },
  { type: 'output-publication-started', ...publication },
  { type: 'output-publication-completed', ...publication, outputCharacters: 0 },
  { type: 'output-publication-failed', ...publication, stage: 'write', errorCode: 'OUTPUT_FAILED' },
  {
    type: 'agent-loop-started',
    ...workflow,
    sessionId: 'session',
    maxModelTurns: 1,
    maxOutputCharacters: 1,
  },
  {
    type: 'agent-loop-completed',
    ...workflow,
    modelTurns: 0,
    toolCalls: 0,
    totalToolResultCharacters: 0,
  },
  {
    type: 'agent-loop-failed',
    ...workflow,
    modelTurns: 0,
    toolCalls: 0,
    totalToolResultCharacters: 0,
    errorCode: 'LOOP_FAILED',
  },
  { type: 'model-turn-started', ...workflow, modelTurnIndex: 1 },
  { type: 'model-turn-completed', ...workflow, modelTurnIndex: 1 },
  { type: 'tool-call-started', ...workflow, callId: 'call', toolName: 'lookup' },
  {
    type: 'tool-call-completed',
    ...workflow,
    callId: 'call',
    toolName: 'lookup',
    status: 'success',
    resultCharacters: 0,
  },
  {
    type: 'model-response-completed',
    ...modelResponse,
    provenanceKind: 'provider-model',
    provider: 'provider',
    model: 'model',
  },
  {
    type: 'model-response-completed',
    ...modelResponse,
    provenanceKind: 'engine-defined',
    provenanceType: 'example.runtime-target',
  },
] as const satisfies readonly AgentTraceEventDetails[];

// Adding a public event requires an independently authored example above.
const allEventTypesCovered: Exclude<
  AgentTraceEventDetails['type'],
  (typeof TRACE_EVENT_EXAMPLES)[number]['type']
> extends never
  ? true
  : false = true;
void allEventTypesCovered;
