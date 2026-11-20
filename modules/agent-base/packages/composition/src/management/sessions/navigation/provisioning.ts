import type { SessionNavigationCoordinatorPort } from '@print-an-agent/base-session';
import { AgentManagementError, type AgentManagementOperation } from '../../operation/index.js';
import type { SessionNavigationPorts } from './types/ports.js';

function findDataProperty(
  operation: AgentManagementOperation,
  value: object,
  key: string
): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!Object.hasOwn(descriptor, 'value')) {
        return invalidPorts(
          operation,
          `Session navigation port member "${key}" must be a data property.`
        );
      }
      return descriptor.value as unknown;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

export function invalidPorts(operation: AgentManagementOperation, message: string): never {
  throw new AgentManagementError('MANAGED_AGENT_SESSION_INVALID', operation, message);
}

function validateNavigationSessionPort(
  operation: AgentManagementOperation,
  value: unknown
): asserts value is SessionNavigationCoordinatorPort {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return invalidPorts(operation, 'Session navigation ports.session must be an object.');
  }
  for (const method of ['inspect', 'applyNavigation']) {
    if (typeof findDataProperty(operation, value, method) !== 'function') {
      invalidPorts(operation, `Session navigation ports.session.${method} must be a function.`);
    }
  }
}

export function validateNavigationPorts(
  operation: AgentManagementOperation,
  value: unknown
): SessionNavigationPorts {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return invalidPorts(operation, 'Session navigation ports must be an object.');
  }
  const session = findDataProperty(operation, value, 'session');
  validateNavigationSessionPort(operation, session);
  const acquire = findDataProperty(operation, session, 'acquireSessionExecution');
  const release = findDataProperty(operation, session, 'releaseSessionExecution');
  if (
    !(
      (acquire === undefined && release === undefined) ||
      (typeof acquire === 'function' && typeof release === 'function')
    )
  ) {
    return invalidPorts(
      operation,
      'Session navigation execution admission requires both acquire and release methods.'
    );
  }
  return Object.freeze({ session });
}
