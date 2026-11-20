import type { SessionId } from '../../contracts/index.js';
import { parseSessionBranchId, parseSessionId, parseTurnId } from '../../contracts/index.js';
import { AgentSessionError } from '../../errors.js';
import { enumerableDataProperty, isPlainRecord } from '../../validation/data-record.js';
import type { ValidatedSessionNavigationCommand } from '../types/command.js';

interface NavigationRecord {
  readonly [key: string]: unknown;
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
  if (!isPlainRecord(input)) return invalid('Session navigation input must be a plain record.');
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
  return enumerableDataProperty(input, key) !== undefined;
}

function field(record: NavigationRecord, key: string): unknown {
  const descriptor = enumerableDataProperty(record, key);
  if (descriptor === undefined) {
    return invalid(`Session navigation field "${key}" is invalid.`);
  }
  return descriptor.value;
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

export function parseSessionNavigationInput(input: unknown): Readonly<{
  sessionId: SessionId;
  command: ValidatedSessionNavigationCommand;
}> {
  const record = navigationRecord(
    input,
    ['operation', 'sessionId'],
    ['branchId', 'expectedRevision', 'newBranchId', 'sourceBranchId', 'throughTurnId']
  );
  const sessionId = parseSessionId(field(record, 'sessionId'));
  return Object.freeze({ sessionId, command: parseCommand(record) });
}
