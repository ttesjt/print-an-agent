import { AgentConfigError } from '@print-an-agent/base-config';
import { AgentIdentityError } from '@print-an-agent/base-identity';
import { AgentSessionError } from '@print-an-agent/base-session';
import { ManagedAgentNamespaceError } from './contracts/namespace.js';
import { SessionMemoryCommitError } from './context-memory/mutations.js';
import { parseMemoryReceipt } from '@print-an-agent/context-memory';
import {
  AgentManagementError,
  type AgentManagementFailureSummary,
  type AgentManagementOperation,
} from './errors.js';

const PRIVATE_IDENTITY_ERROR_CODES = new Set<AgentIdentityError['code']>([
  'AGENT_IDENTITY_CONFIGURATION_INVALID',
  'AGENT_IDENTITY_PATH_INVALID',
  'AGENT_IDENTITY_SCHEMA_INVALID',
  'AGENT_IDENTITY_SCHEMA_UNSUPPORTED',
  'AGENT_IDENTITY_STORAGE_FAILED',
]);

const PRIVATE_CONFIG_ERROR_CODES = new Set<AgentConfigError['code']>([
  'CONFIG_CONFIGURATION_INVALID',
  'CONFIG_PATH_INVALID',
  'CONFIG_STORAGE_FAILED',
  'CONFIG_STORAGE_SCHEMA_INVALID',
  'CONFIG_STORAGE_SCHEMA_UNSUPPORTED',
]);

const PRIVATE_SESSION_ERROR_CODES = new Set<AgentSessionError['code']>([
  'SESSION_CONFIGURATION_INVALID',
  'SESSION_PATH_INVALID',
  'SESSION_SCHEMA_UNSUPPORTED',
  'SESSION_SCHEMA_INVALID',
  'SESSION_RECORD_INVALID',
  'SESSION_STORAGE_FAILED',
  'SESSION_PURGE_FAILED',
  'SESSION_RECOVERY_FAILED',
]);

function safeIdentityFailure(failure: AgentIdentityError): AgentIdentityError {
  const message = PRIVATE_IDENTITY_ERROR_CODES.has(failure.code)
    ? 'Agent Identity persistence failed.'
    : failure.message;
  return new AgentIdentityError(failure.code, message);
}

function safeConfigFailure(failure: AgentConfigError): AgentConfigError {
  const message = PRIVATE_CONFIG_ERROR_CODES.has(failure.code)
    ? 'Agent Config persistence failed.'
    : failure.message;
  return new AgentConfigError(failure.code, message);
}

function safeSessionFailure(failure: AgentSessionError): AgentSessionError {
  const message = PRIVATE_SESSION_ERROR_CODES.has(failure.code)
    ? 'Session persistence failed.'
    : failure.message;
  return new AgentSessionError(failure.code, message);
}

export function summarizeManagementFailure(cause: unknown): AgentManagementFailureSummary {
  if (cause instanceof AgentIdentityError) {
    return Object.freeze({ domain: 'identity', code: cause.code });
  }
  if (cause instanceof AgentConfigError) {
    return Object.freeze({ domain: 'config', code: cause.code });
  }
  if (cause instanceof AgentSessionError) {
    return Object.freeze({ domain: 'session', code: cause.code });
  }
  if (cause instanceof ManagedAgentNamespaceError) {
    return Object.freeze({ domain: 'namespace', code: cause.code });
  }
  if (cause instanceof AgentManagementError) {
    return Object.freeze({ domain: 'management', code: cause.code });
  }
  return Object.freeze({ domain: 'unexpected', code: 'UNEXPECTED_FAILURE' });
}

export function safeManagementFailure(operation: AgentManagementOperation, cause: unknown): Error {
  if (cause instanceof AgentManagementError) return cause;
  if (cause instanceof SessionMemoryCommitError) {
    try {
      const input = cause.commit;
      const commit =
        input.status === 'committed'
          ? { status: 'committed' as const, receipt: parseMemoryReceipt(input.receipt) }
          : input.status === 'unknown'
            ? { status: 'unknown' as const, memoryId: input.memoryId, requestId: input.requestId }
            : { status: 'not-committed' as const };
      // Preserve public commit evidence and cleanup classification, never the private error tree.
      return new SessionMemoryCommitError(
        commit,
        cause.code === 'SESSION_MEMORY_CLEANUP_FAILED'
          ? new AgentSessionError(
              'SESSION_MEMORY_CLEANUP_FAILED',
              'Memory resource cleanup is unconfirmed.'
            )
          : undefined,
        cause.code
      );
    } catch {
      return new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory commit evidence is invalid.');
    }
  }
  if (cause instanceof AgentIdentityError) return safeIdentityFailure(cause);
  if (cause instanceof AgentConfigError) return safeConfigFailure(cause);
  if (cause instanceof AgentSessionError) return safeSessionFailure(cause);
  if (
    operation === 'create' &&
    cause instanceof ManagedAgentNamespaceError &&
    cause.code === 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS'
  ) {
    return new AgentManagementError(
      'MANAGED_AGENT_ALREADY_EXISTS',
      operation,
      'Managed Agent already exists.'
    );
  }
  return new AgentManagementError(
    'MANAGED_AGENT_OPERATION_FAILED',
    operation,
    'Managed Agent operation failed.'
  );
}

export async function runManagementOperation<TResult>(
  operation: AgentManagementOperation,
  action: () => Promise<TResult>
): Promise<TResult> {
  try {
    return await action();
  } catch (cause: unknown) {
    throw safeManagementFailure(operation, cause);
  }
}
