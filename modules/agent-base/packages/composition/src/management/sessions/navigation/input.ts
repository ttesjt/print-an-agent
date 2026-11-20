import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type SessionNavigationOperationOptions,
} from '@print-an-agent/base-session';
import type { PreparedNavigationRequest } from './types/context.js';

function invalidRequest(message: string): never {
  throw new AgentSessionError('SESSION_NAVIGATION_INVALID', message);
}

function requireRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): object {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalidRequest('Session navigation Service input must be a plain record.');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) {
    return invalidRequest('Session navigation Service input must be a plain record.');
  }
  const allowed = new Set([...required, ...optional]);
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || !allowed.has(key) || !isDataField(input, key)
    ) ||
    required.some((key) => !Object.hasOwn(input, key))
  ) {
    return invalidRequest('Session navigation Service input has unsupported or missing fields.');
  }
  return input;
}

function isDataField(input: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return (
    descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value')
  );
}

function field(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return invalidRequest(`Session navigation Service field "${key}" is invalid.`);
  }
  return descriptor.value as unknown;
}

function optionalField(input: object, key: string): unknown {
  return Object.hasOwn(input, key) ? field(input, key) : undefined;
}

function expectedRevision(input: object): number {
  const value = field(input, 'expectedRevision');
  if (typeof value !== 'number') {
    return invalidRequest('Session navigation expectedRevision must be a number.');
  }
  return value;
}

export function normalizeInspect(input: unknown): PreparedNavigationRequest {
  const record = requireRecord(input, ['agentId', 'sessionId']);
  return Object.freeze({
    agentId: parseAgentId(field(record, 'agentId')),
    navigation: Object.freeze({
      operation: 'inspect',
      sessionId: parseSessionId(field(record, 'sessionId')),
    }),
  });
}

export function normalizeSelect(input: unknown): PreparedNavigationRequest {
  const record = requireRecord(input, ['agentId', 'branchId', 'expectedRevision', 'sessionId']);
  return Object.freeze({
    agentId: parseAgentId(field(record, 'agentId')),
    navigation: Object.freeze({
      operation: 'select',
      sessionId: parseSessionId(field(record, 'sessionId')),
      branchId: parseSessionBranchId(field(record, 'branchId')),
      expectedRevision: expectedRevision(record),
    }),
  });
}

export function normalizeFork(input: unknown): PreparedNavigationRequest {
  const record = requireRecord(
    input,
    ['agentId', 'expectedRevision', 'sessionId', 'sourceBranchId', 'throughTurnId'],
    ['newBranchId']
  );
  const newBranchIdInput = optionalField(record, 'newBranchId');
  return Object.freeze({
    agentId: parseAgentId(field(record, 'agentId')),
    navigation: Object.freeze({
      operation: 'fork',
      sessionId: parseSessionId(field(record, 'sessionId')),
      sourceBranchId: parseSessionBranchId(field(record, 'sourceBranchId')),
      throughTurnId: parseTurnId(field(record, 'throughTurnId')),
      ...(newBranchIdInput === undefined
        ? {}
        : { newBranchId: parseSessionBranchId(newBranchIdInput) }),
      expectedRevision: expectedRevision(record),
    }),
  });
}

export function normalizeRewind(input: unknown): PreparedNavigationRequest {
  const record = requireRecord(
    input,
    ['agentId', 'expectedRevision', 'sessionId', 'throughTurnId'],
    ['newBranchId']
  );
  const newBranchIdInput = optionalField(record, 'newBranchId');
  return Object.freeze({
    agentId: parseAgentId(field(record, 'agentId')),
    navigation: Object.freeze({
      operation: 'rewind',
      sessionId: parseSessionId(field(record, 'sessionId')),
      throughTurnId: parseTurnId(field(record, 'throughTurnId')),
      ...(newBranchIdInput === undefined
        ? {}
        : { newBranchId: parseSessionBranchId(newBranchIdInput) }),
      expectedRevision: expectedRevision(record),
    }),
  });
}

export function normalizeOptions(input: unknown): SessionNavigationOperationOptions {
  if (input === undefined) return Object.freeze({});
  const record = requireRecord(input, [], ['signal']);
  const signal = optionalField(record, 'signal');
  if (signal === undefined) return Object.freeze({});
  if (!(signal instanceof AbortSignal)) {
    return invalidRequest('Session navigation Service signal must be an AbortSignal.');
  }
  return Object.freeze({ signal });
}
