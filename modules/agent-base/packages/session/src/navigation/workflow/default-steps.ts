import type { StepOverrides } from '@ta-agent/base-workflow';
import { AgentSessionError } from '../../errors.js';
import { parseSessionBranchId, parseSessionId, parseTurnId } from '../../identifiers.js';
import { toSessionNavigationSnapshot } from '../lineage.js';
import type {
  NavigateSessionInput,
  SessionNavigationOutcome,
  ValidatedSessionNavigationCommand,
} from '../contracts.js';
import type { SessionNavigationStepName } from './names.js';
import type { SessionNavigationWorkflowContext } from './types.js';

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation input must be an object.'
    );
  }
  return value as UnknownRecord;
}

function assertKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[]
) {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation input has unsupported or missing fields.'
    );
  }
}

function parseExpectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation expectedRevision must be a non-negative safe integer.'
    );
  }
  return value;
}

function optionalBranchId(value: unknown) {
  return value === undefined ? undefined : parseSessionBranchId(value);
}

function parseCommand(record: UnknownRecord): ValidatedSessionNavigationCommand {
  if (record.operation === 'inspect') {
    assertKeys(record, ['operation', 'sessionId'], []);
    return Object.freeze({ operation: 'inspect' });
  }
  if (record.operation === 'select') {
    assertKeys(record, ['branchId', 'expectedRevision', 'operation', 'sessionId'], []);
    return Object.freeze({
      operation: 'select',
      branchId: parseSessionBranchId(record.branchId),
      expectedRevision: parseExpectedRevision(record.expectedRevision),
    });
  }
  if (record.operation === 'fork') {
    assertKeys(
      record,
      ['expectedRevision', 'operation', 'sessionId', 'sourceBranchId', 'throughTurnId'],
      ['newBranchId']
    );
    const newBranchId = optionalBranchId(record.newBranchId);
    return Object.freeze({
      operation: 'fork',
      sourceBranchId: parseSessionBranchId(record.sourceBranchId),
      throughTurnId: parseTurnId(record.throughTurnId),
      ...(newBranchId === undefined ? {} : { newBranchId }),
      expectedRevision: parseExpectedRevision(record.expectedRevision),
    });
  }
  if (record.operation === 'rewind') {
    assertKeys(
      record,
      ['expectedRevision', 'operation', 'sessionId', 'throughTurnId'],
      ['newBranchId']
    );
    const newBranchId = optionalBranchId(record.newBranchId);
    return Object.freeze({
      operation: 'rewind',
      throughTurnId: parseTurnId(record.throughTurnId),
      ...(newBranchId === undefined ? {} : { newBranchId }),
      expectedRevision: parseExpectedRevision(record.expectedRevision),
    });
  }
  throw new AgentSessionError(
    'SESSION_NAVIGATION_INVALID',
    'Session navigation operation must be inspect, select, fork, or rewind.'
  );
}

function requireCommand(context: SessionNavigationWorkflowContext) {
  if (context.command === undefined || context.sessionId === undefined) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation context is incomplete.'
    );
  }
  return { command: context.command, sessionId: context.sessionId } as const;
}

function validateSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  const record = requireRecord(context.agentContext.input satisfies NavigateSessionInput);
  context.sessionId = parseSessionId(record.sessionId);
  context.command = parseCommand(record);
  return Promise.resolve();
}

async function inspectSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  const { command, sessionId } = requireCommand(context);
  const snapshot = await context.resources.session.inspect({
    agentId: context.agentContext.identity.id,
    sessionId,
  });
  if (snapshot === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" does not exist for agent "${context.agentContext.identity.id}".`
    );
  }
  context.snapshot = snapshot;
  if (command.operation === 'inspect') {
    context.result = Object.freeze({
      status: 'inspected',
      navigation: toSessionNavigationSnapshot(snapshot),
    });
  }
}

function outcomeStatus(operation: 'select' | 'fork' | 'rewind') {
  return operation === 'select' ? 'selected' : operation === 'fork' ? 'forked' : 'rewound';
}

async function commitSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  if (context.result !== undefined) return;
  if (context.signal.aborted) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_CANCELLED',
      'Session navigation was cancelled before mutation.'
    );
  }
  const { command, sessionId } = requireCommand(context);
  if (command.operation === 'inspect') return;
  const applied = await context.resources.session.applyNavigation({
    agentId: context.agentContext.identity.id,
    sessionId,
    command,
  });
  const result: SessionNavigationOutcome = Object.freeze({
    status: outcomeStatus(applied.operation),
    sessionId,
    selectedBranchId: applied.navigation.selectedBranchId,
    affectedBranchId: applied.affectedBranchId,
    revision: applied.navigation.revision,
  });
  await context.agentContext.traceEmitter?.record({
    type: 'session-navigation-applied',
    workflowName: context.workflowName,
    workflowRunId: context.workflowRunId,
    operation: applied.operation,
    sessionId,
    selectedBranchId: applied.navigation.selectedBranchId,
    affectedBranchId: applied.affectedBranchId,
    navigationRevision: applied.navigation.revision,
  });
  context.result = result;
}

export function createDefaultSessionNavigationStepOverrides(): StepOverrides<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
> {
  return Object.freeze({
    validateSessionNavigation,
    inspectSessionNavigation,
    commitSessionNavigation,
  });
}
