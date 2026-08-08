import { AgentObservabilityError } from './errors.js';
import type { AgentTraceEvent, AgentTraceEventDetails } from './types.js';

const ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'agentId',
  'agentRunId',
  'sequence',
  'timestamp',
]);
const IDENTIFIER_MAX_LENGTH = 256;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidEvent(message: string): never {
  throw new AgentObservabilityError('TRACE_EVENT_INVALID', message);
}

function requireString(value: unknown, name: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > IDENTIFIER_MAX_LENGTH) {
    invalidEvent(`${name} must contain 1-${IDENTIFIER_MAX_LENGTH} characters.`);
  }
}

function requireErrorCode(value: unknown): void {
  if (typeof value !== 'string' || !ERROR_CODE_PATTERN.test(value)) {
    invalidEvent('Trace errorCode must be a bounded uppercase structured code.');
  }
}

function requireCount(value: unknown, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < minimum) {
    invalidEvent(`${name} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function requireBoolean(value: unknown, name: string): void {
  if (typeof value !== 'boolean') invalidEvent(`${name} must be a boolean.`);
}

function requireOneOf(value: unknown, allowed: readonly string[], name: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    invalidEvent(`${name} is not supported.`);
  }
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  eventKeys: readonly string[],
  includeEnvelope: boolean
): void {
  const allowed = new Set(['type', ...eventKeys, ...(includeEnvelope ? ENVELOPE_KEYS : [])]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    Object.keys(record).length !== allowed.size
  ) {
    invalidEvent('Trace event contains missing, unknown, or contradictory fields.');
  }
}

function requireWorkflowReference(record: Readonly<Record<string, unknown>>): void {
  requireString(record.workflowName, 'Trace workflowName');
  requireString(record.workflowRunId, 'Trace workflowRunId');
}

function requireStepReference(record: Readonly<Record<string, unknown>>): void {
  requireWorkflowReference(record);
  requireString(record.stepName, 'Trace stepName');
}

function validateDetailsRecord(
  record: Readonly<Record<string, unknown>>,
  includeEnvelope: boolean
): void {
  const type = record.type;
  if (typeof type !== 'string') invalidEvent('Trace event type must be a string.');

  if (type === 'agent-run-started' || type === 'agent-run-completed') {
    assertExactKeys(record, [], includeEnvelope);
    return;
  }
  if (type === 'agent-run-failed') {
    assertExactKeys(record, ['errorCode'], includeEnvelope);
    requireErrorCode(record.errorCode);
    return;
  }
  if (type === 'workflow-run-skipped') {
    assertExactKeys(record, ['workflowName'], includeEnvelope);
    requireString(record.workflowName, 'Trace workflowName');
    return;
  }
  if (
    type === 'workflow-run-started' ||
    type === 'workflow-run-completed' ||
    type === 'workflow-run-failed'
  ) {
    const keys =
      type === 'workflow-run-failed'
        ? ['workflowName', 'workflowRunId', 'errorCode']
        : ['workflowName', 'workflowRunId'];
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    if (type === 'workflow-run-failed') requireErrorCode(record.errorCode);
    return;
  }
  if (
    type === 'step-started' ||
    type === 'step-skipped' ||
    type === 'step-completed' ||
    type === 'step-failed'
  ) {
    const keys =
      type === 'step-failed'
        ? ['workflowName', 'workflowRunId', 'stepName', 'errorCode']
        : ['workflowName', 'workflowRunId', 'stepName'];
    assertExactKeys(record, keys, includeEnvelope);
    requireStepReference(record);
    if (type === 'step-failed') requireErrorCode(record.errorCode);
    return;
  }
  if (type === 'session-resolved') {
    assertExactKeys(
      record,
      ['workflowName', 'workflowRunId', 'sessionId', 'branchId', 'navigationRevision'],
      includeEnvelope
    );
    requireWorkflowReference(record);
    requireString(record.sessionId, 'Trace sessionId');
    requireString(record.branchId, 'Trace branchId');
    requireCount(record.navigationRevision, 'Trace navigationRevision');
    return;
  }
  if (type === 'session-navigation-applied') {
    assertExactKeys(
      record,
      [
        'workflowName',
        'workflowRunId',
        'operation',
        'sessionId',
        'selectedBranchId',
        'affectedBranchId',
        'navigationRevision',
      ],
      includeEnvelope
    );
    requireWorkflowReference(record);
    requireOneOf(record.operation, ['select', 'fork', 'rewind'], 'Navigation operation');
    requireString(record.sessionId, 'Trace sessionId');
    requireString(record.selectedBranchId, 'Trace selectedBranchId');
    requireString(record.affectedBranchId, 'Trace affectedBranchId');
    requireCount(record.navigationRevision, 'Trace navigationRevision');
    return;
  }
  if (type === 'request-replay-resolved') {
    assertExactKeys(
      record,
      ['workflowName', 'workflowRunId', 'sessionId', 'status'],
      includeEnvelope
    );
    requireWorkflowReference(record);
    requireString(record.sessionId, 'Trace sessionId');
    requireOneOf(
      record.status,
      ['claimed', 'completed', 'active', 'failed', 'conflict'],
      'Replay status'
    );
    return;
  }
  if (type === 'execution-target-resolved') {
    assertExactKeys(
      record,
      ['workflowName', 'workflowRunId', 'provider', 'model', 'toolsSupported'],
      includeEnvelope
    );
    requireWorkflowReference(record);
    requireString(record.provider, 'Trace provider');
    requireString(record.model, 'Trace model');
    requireBoolean(record.toolsSupported, 'Trace toolsSupported');
    return;
  }
  if (type === 'tools-resolved') {
    const keys = [
      'workflowName',
      'workflowRunId',
      'effectiveToolCount',
      'maxToolCalls',
      'maxArgumentCharacters',
      'maxResultCharacters',
      'maxTotalResultCharacters',
      'toolTimeoutMilliseconds',
    ];
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    for (const key of keys.slice(2)) requireCount(record[key], `Trace ${key}`);
    return;
  }
  if (
    type === 'output-publication-started' ||
    type === 'output-publication-completed' ||
    type === 'output-publication-failed'
  ) {
    const keys = ['workflowName', 'workflowRunId', 'sessionId', 'replayed'];
    if (type === 'output-publication-completed') keys.push('outputCharacters');
    if (type === 'output-publication-failed') keys.push('stage', 'errorCode');
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    requireString(record.sessionId, 'Trace sessionId');
    requireBoolean(record.replayed, 'Trace replayed');
    if (type === 'output-publication-completed') {
      requireCount(record.outputCharacters, 'Trace outputCharacters');
    }
    if (type === 'output-publication-failed') {
      requireOneOf(record.stage, ['open', 'write', 'close'], 'Output publication stage');
      requireErrorCode(record.errorCode);
    }
    return;
  }
  if (type === 'agent-loop-started') {
    const keys = [
      'workflowName',
      'workflowRunId',
      'sessionId',
      'provider',
      'model',
      'maxProviderTurns',
      'maxOutputCharacters',
    ];
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    requireString(record.sessionId, 'Trace sessionId');
    requireString(record.provider, 'Trace provider');
    requireString(record.model, 'Trace model');
    requireCount(record.maxProviderTurns, 'Trace maxProviderTurns', 1);
    requireCount(record.maxOutputCharacters, 'Trace maxOutputCharacters', 1);
    return;
  }
  if (type === 'provider-turn-started' || type === 'provider-turn-completed') {
    assertExactKeys(record, ['workflowName', 'workflowRunId', 'turnIndex'], includeEnvelope);
    requireWorkflowReference(record);
    requireCount(record.turnIndex, 'Trace turnIndex', 1);
    return;
  }
  if (type === 'tool-call-started' || type === 'tool-call-completed') {
    const keys = ['workflowName', 'workflowRunId', 'callId', 'toolName'];
    if (type === 'tool-call-completed') keys.push('status', 'resultCharacters');
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    requireString(record.callId, 'Trace callId');
    requireString(record.toolName, 'Trace toolName');
    if (type === 'tool-call-completed') {
      requireOneOf(record.status, ['success', 'error'], 'Tool trace status');
      requireCount(record.resultCharacters, 'Trace resultCharacters');
    }
    return;
  }
  if (type === 'model-response-completed') {
    const keys = [
      'workflowName',
      'workflowRunId',
      'turnIndex',
      'provider',
      'model',
      'stopReason',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'outputCharacters',
    ];
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    requireCount(record.turnIndex, 'Trace turnIndex', 1);
    requireString(record.provider, 'Trace provider');
    requireString(record.model, 'Trace model');
    requireOneOf(record.stopReason, ['stop', 'length'], 'Model stop reason');
    for (const key of keys.slice(6)) requireCount(record[key], `Trace ${key}`);
    return;
  }
  if (type === 'agent-loop-completed' || type === 'agent-loop-failed') {
    const keys = [
      'workflowName',
      'workflowRunId',
      'providerTurns',
      'toolCalls',
      'totalToolResultCharacters',
    ];
    if (type === 'agent-loop-failed') keys.push('errorCode');
    assertExactKeys(record, keys, includeEnvelope);
    requireWorkflowReference(record);
    requireCount(record.providerTurns, 'Trace providerTurns');
    requireCount(record.toolCalls, 'Trace toolCalls');
    requireCount(record.totalToolResultCharacters, 'Trace totalToolResultCharacters');
    if (type === 'agent-loop-failed') requireErrorCode(record.errorCode);
    return;
  }
  invalidEvent(`Trace event type "${type}" is not supported.`);
}

export function validateAgentTraceEventDetails(
  value: unknown
): asserts value is AgentTraceEventDetails {
  if (!isUnknownRecord(value)) invalidEvent('Trace event details must be an object.');
  validateDetailsRecord(value, false);
}

export function validateAgentTraceEvent(value: unknown): asserts value is AgentTraceEvent {
  if (!isUnknownRecord(value)) invalidEvent('Trace event must be an object.');
  if (value.schemaVersion !== 1) invalidEvent('Trace event schemaVersion is not supported.');
  requireString(value.agentId, 'Trace agentId');
  requireString(value.agentRunId, 'Trace agentRunId');
  requireCount(value.sequence, 'Trace sequence', 1);
  requireCount(value.timestamp, 'Trace timestamp');
  validateDetailsRecord(value, true);
}
