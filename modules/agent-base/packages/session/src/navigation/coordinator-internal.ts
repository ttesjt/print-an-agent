import { AgentSessionError } from '../errors.js';
import { supportsSessionExecution, type SessionExecutionLease } from '../lifecycle/execution.js';
import { parseSessionBranchId, parseSessionId, parseTurnId } from '../identifiers.js';
import type { SessionId, SessionSnapshot } from '../types.js';
import type {
  AppliedSessionNavigation,
  NavigateSessionInput,
  SessionNavigationCoordinatorPort,
  SessionNavigationOutcome,
  ValidatedSessionNavigationCommand,
} from './contracts.js';
import { toSessionNavigationSnapshot } from './lineage.js';
import type { AgentId } from '@ta-agent/base-identity';

interface NavigationRecord {
  readonly [key: string]: unknown;
}

export interface SessionNavigationExecutionState {
  readonly agentId: AgentId;
  readonly input: NavigateSessionInput;
  readonly resources: Readonly<{ session: SessionNavigationCoordinatorPort }>;
  readonly signal: AbortSignal;
  sessionId?: SessionId;
  execution?: SessionExecutionLease;
  command?: ValidatedSessionNavigationCommand;
  snapshot?: SessionSnapshot;
  result?: SessionNavigationOutcome;
}

function invalid(message: string): never {
  throw new AgentSessionError('SESSION_NAVIGATION_INVALID', message);
}

/** Read descriptors rather than invoking accessors at the public navigation boundary. */
function navigationRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): NavigationRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('Session navigation input must be a plain record.');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) {
    return invalid('Session navigation input must be a plain record.');
  }
  const allowed = new Set([...required, ...optional]);
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || !allowed.has(key) || !isDataField(input, key)
    ) ||
    required.some((key) => !Object.hasOwn(input, key))
  ) {
    return invalid('Session navigation input has unsupported or missing fields.');
  }
  return input as NavigationRecord;
}

function isDataField(input: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return (
    descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value')
  );
}

function field(record: NavigationRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return invalid(`Session navigation field "${key}" is invalid.`);
  }
  return descriptor.value as unknown;
}

function expectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalid('Session navigation expectedRevision must be a non-negative safe integer.');
  }
  return value;
}

function optionalBranchId(value: unknown) {
  return value === undefined ? undefined : parseSessionBranchId(value);
}

function parseCommand(record: NavigationRecord): ValidatedSessionNavigationCommand {
  const operation = field(record, 'operation');
  if (operation === 'inspect') {
    navigationRecord(record, ['operation', 'sessionId']);
    return Object.freeze({ operation });
  }
  if (operation === 'select') {
    navigationRecord(record, ['branchId', 'expectedRevision', 'operation', 'sessionId']);
    return Object.freeze({
      operation,
      branchId: parseSessionBranchId(field(record, 'branchId')),
      expectedRevision: expectedRevision(field(record, 'expectedRevision')),
    });
  }
  if (operation === 'fork') {
    navigationRecord(
      record,
      ['expectedRevision', 'operation', 'sessionId', 'sourceBranchId', 'throughTurnId'],
      ['newBranchId']
    );
    const newBranchId = optionalBranchId(
      Object.hasOwn(record, 'newBranchId') ? field(record, 'newBranchId') : undefined
    );
    return Object.freeze({
      operation,
      sourceBranchId: parseSessionBranchId(field(record, 'sourceBranchId')),
      throughTurnId: parseTurnId(field(record, 'throughTurnId')),
      ...(newBranchId === undefined ? {} : { newBranchId }),
      expectedRevision: expectedRevision(field(record, 'expectedRevision')),
    });
  }
  if (operation === 'rewind') {
    navigationRecord(
      record,
      ['expectedRevision', 'operation', 'sessionId', 'throughTurnId'],
      ['newBranchId']
    );
    const newBranchId = optionalBranchId(
      Object.hasOwn(record, 'newBranchId') ? field(record, 'newBranchId') : undefined
    );
    return Object.freeze({
      operation,
      throughTurnId: parseTurnId(field(record, 'throughTurnId')),
      ...(newBranchId === undefined ? {} : { newBranchId }),
      expectedRevision: expectedRevision(field(record, 'expectedRevision')),
    });
  }
  return invalid('Session navigation operation must be inspect, select, fork, or rewind.');
}

function requireValidatedState(state: SessionNavigationExecutionState) {
  if (state.command === undefined || state.sessionId === undefined) {
    return invalid('Session navigation state is incomplete.');
  }
  return Object.freeze({ command: state.command, sessionId: state.sessionId });
}

function cancelled(signal: AbortSignal): never {
  throw new AgentSessionError(
    'SESSION_NAVIGATION_CANCELLED',
    'Session navigation was cancelled before its commit boundary.',
    signal.reason === undefined ? undefined : { cause: signal.reason }
  );
}

export function assertSessionNavigationActive(signal: AbortSignal): void {
  if (signal.aborted) cancelled(signal);
}

export function validateSessionNavigationState(state: SessionNavigationExecutionState): void {
  assertSessionNavigationActive(state.signal);
  const record = navigationRecord(
    state.input,
    ['operation', 'sessionId'],
    ['branchId', 'expectedRevision', 'newBranchId', 'sourceBranchId', 'throughTurnId']
  );
  state.sessionId = parseSessionId(field(record, 'sessionId'));
  state.command = parseCommand(record);
}

export async function inspectSessionNavigationState(
  state: SessionNavigationExecutionState
): Promise<void> {
  const { command, sessionId } = requireValidatedState(state);
  assertSessionNavigationActive(state.signal);
  if (command.operation !== 'inspect' && supportsSessionExecution(state.resources.session)) {
    state.execution = await state.resources.session.acquireSessionExecution({
      agentId: state.agentId,
      sessionId,
    });
    assertSessionNavigationActive(state.signal);
  }
  const snapshot = await state.resources.session.inspect({
    agentId: state.agentId,
    sessionId,
  });
  if (snapshot === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" does not exist for agent "${state.agentId}".`
    );
  }
  state.snapshot = snapshot;
  assertSessionNavigationActive(state.signal);
  if (command.operation === 'inspect') {
    state.result = Object.freeze({
      status: 'inspected',
      navigation: toSessionNavigationSnapshot(snapshot),
    });
  }
}

function outcomeStatus(operation: 'select' | 'fork' | 'rewind') {
  return operation === 'select' ? 'selected' : operation === 'fork' ? 'forked' : 'rewound';
}

export async function commitSessionNavigationState(
  state: SessionNavigationExecutionState
): Promise<AppliedSessionNavigation | undefined> {
  if (state.result !== undefined) return undefined;
  const { command, sessionId } = requireValidatedState(state);
  if (command.operation === 'inspect') return undefined;
  assertSessionNavigationActive(state.signal);
  const applied = await state.resources.session.applyNavigation({
    agentId: state.agentId,
    sessionId,
    command,
    ...(state.execution === undefined ? {} : { execution: state.execution }),
  });
  state.result = Object.freeze({
    status: outcomeStatus(applied.operation),
    sessionId,
    selectedBranchId: applied.navigation.selectedBranchId,
    affectedBranchId: applied.affectedBranchId,
    revision: applied.navigation.revision,
  });
  return applied;
}
