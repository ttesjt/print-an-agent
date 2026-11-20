import { AgentConfigError } from '@print-an-agent/base-identity-config/config';
import { AgentIdentityError } from '@print-an-agent/base-identity-config/identity';
import { AgentSessionError } from '@print-an-agent/base-session';
import { ManagedAgentNamespaceError } from '../namespace/index.js';
import { AgentManagementError, type AgentManagementFailureSummary } from '../operation/index.js';

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
