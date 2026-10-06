import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import {
  AgentSessionError,
  executeSessionNavigation,
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type NavigateSessionInput,
  type SessionNavigationCoordinatorPort,
  type SessionNavigationOperationOptions,
  type SessionNavigationOutcome,
} from '@ta-agent/base-session';
import type { ManagedAgentNamespacePort } from './contracts/namespace.js';
import type {
  ForkManagedSessionBranchInput,
  InspectManagedSessionNavigationInput,
  RewindManagedSessionBranchInput,
  SelectManagedSessionBranchInput,
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationCapability,
  SessionNavigationInspectionOutcome,
  SessionNavigationPorts,
} from './contracts/session-navigation.js';
import { AgentManagementError, type AgentManagementOperation } from './errors.js';
import { resolveManagedAgentNamespace } from './namespace.js';

type SessionNavigationDefinition<TNamespaceHandle> = Readonly<{
  namespace: Readonly<{ port: ManagedAgentNamespacePort<TNamespaceHandle> }>;
}> &
  SessionNavigationCapability<TNamespaceHandle, SessionNavigationPorts>;

interface PreparedNavigationRequest {
  readonly agentId: AgentId;
  readonly navigation: NavigateSessionInput;
}

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

function normalizeInspect(input: unknown): PreparedNavigationRequest {
  const record = requireRecord(input, ['agentId', 'sessionId']);
  return Object.freeze({
    agentId: parseAgentId(field(record, 'agentId')),
    navigation: Object.freeze({
      operation: 'inspect',
      sessionId: parseSessionId(field(record, 'sessionId')),
    }),
  });
}

function normalizeSelect(input: unknown): PreparedNavigationRequest {
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

function normalizeFork(input: unknown): PreparedNavigationRequest {
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

function normalizeRewind(input: unknown): PreparedNavigationRequest {
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

function normalizeOptions(input: unknown): SessionNavigationOperationOptions {
  if (input === undefined) return Object.freeze({});
  const record = requireRecord(input, [], ['signal']);
  const signal = optionalField(record, 'signal');
  if (signal === undefined) return Object.freeze({});
  if (!(signal instanceof AbortSignal)) {
    return invalidRequest('Session navigation Service signal must be an AbortSignal.');
  }
  return Object.freeze({ signal });
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new AgentSessionError(
    'SESSION_NAVIGATION_CANCELLED',
    'Session navigation was cancelled before its commit boundary.',
    signal.reason === undefined ? undefined : { cause: signal.reason }
  );
}

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

function invalidPorts(operation: AgentManagementOperation, message: string): never {
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

function validateNavigationPorts(
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

async function executeManagedNavigation<TNamespaceHandle>(
  operation: AgentManagementOperation,
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  request: PreparedNavigationRequest,
  options: SessionNavigationOperationOptions
): Promise<SessionNavigationOutcome> {
  assertActive(options.signal);
  const namespace = await resolveManagedAgentNamespace(
    operation,
    definition.namespace.port,
    request.agentId
  );
  assertActive(options.signal);
  const ports = validateNavigationPorts(
    operation,
    await definition.sessionNavigation.createPorts(namespace)
  );
  assertActive(options.signal);
  return executeSessionNavigation(
    {
      agentId: request.agentId,
      navigation: request.navigation,
      session: ports.session,
    },
    options
  );
}

export async function inspectManagedSessionNavigation<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: InspectManagedSessionNavigationInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionNavigationInspectionOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'inspect-session-navigation',
    definition,
    normalizeInspect(input),
    options
  );
  if (outcome.status !== 'inspected') {
    return invalidPorts(
      'inspect-session-navigation',
      'Session navigation coordinator returned an invalid inspection outcome.'
    );
  }
  return outcome;
}

export async function selectManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: SelectManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchSelectionOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'select-session-branch',
    definition,
    normalizeSelect(input),
    options
  );
  if (outcome.status !== 'selected') {
    return invalidPorts(
      'select-session-branch',
      'Session navigation coordinator returned an invalid selection outcome.'
    );
  }
  return outcome;
}

export async function forkManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: ForkManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchForkOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'fork-session-branch',
    definition,
    normalizeFork(input),
    options
  );
  if (outcome.status !== 'forked') {
    return invalidPorts(
      'fork-session-branch',
      'Session navigation coordinator returned an invalid fork outcome.'
    );
  }
  return outcome;
}

export async function rewindManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: RewindManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchRewindOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'rewind-session-branch',
    definition,
    normalizeRewind(input),
    options
  );
  if (outcome.status !== 'rewound') {
    return invalidPorts(
      'rewind-session-branch',
      'Session navigation coordinator returned an invalid rewind outcome.'
    );
  }
  return outcome;
}
