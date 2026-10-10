import type { ManagementOperationOptions } from './contracts/operation.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';

const EMPTY_OPTIONS = Object.freeze({});

function invalidOptions(operation: AgentManagementOperation): never {
  throw new AgentManagementError(
    'MANAGED_AGENT_REQUEST_INVALID',
    operation,
    'Management operation options must contain only an optional AbortSignal.'
  );
}

export function normalizeManagementOperationOptions(
  operation: AgentManagementOperation,
  input: unknown
): ManagementOperationOptions {
  if (input === undefined) return EMPTY_OPTIONS;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalidOptions(operation);
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) return invalidOptions(operation);
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => key !== 'signal') || keys.length > 1) return invalidOptions(operation);
  if (!Object.hasOwn(input, 'signal')) return EMPTY_OPTIONS;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'signal');
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value') ||
    descriptor.value === undefined
  ) {
    return invalidOptions(operation);
  }
  if (!(descriptor.value instanceof AbortSignal)) return invalidOptions(operation);
  return Object.freeze({ signal: descriptor.value });
}

export function assertManagementOperationActive(
  operation: AgentManagementOperation,
  signal: AbortSignal | undefined
): void {
  if (signal?.aborted !== true) return;
  throw new AgentManagementError(
    'MANAGED_AGENT_OPERATION_CANCELLED',
    operation,
    'Management operation was cancelled before its commit boundary.'
  );
}
