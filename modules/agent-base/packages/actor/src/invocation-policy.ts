import { AgentActorError } from './errors.js';

export const NO_ACTOR_INVOCATION_TIMEOUT = null;
export const MAX_ACTOR_INVOCATION_TIMEOUT_MILLISECONDS = 2_147_483_647;

export type ActorInvocationTimeoutMilliseconds = number | null;

export interface ActorInvocationPolicyInput {
  readonly timeoutMilliseconds: ActorInvocationTimeoutMilliseconds;
}

export interface ActorInvocationPolicy {
  readonly timeoutMilliseconds: ActorInvocationTimeoutMilliseconds;
}

export const DEFAULT_ACTOR_INVOCATION_POLICY: ActorInvocationPolicy = Object.freeze({
  timeoutMilliseconds: NO_ACTOR_INVOCATION_TIMEOUT,
});

const POLICY_KEYS = new Set<PropertyKey>(['timeoutMilliseconds']);

export function defineActorInvocationPolicy(
  input: ActorInvocationPolicyInput | undefined
): ActorInvocationPolicy {
  if (input === undefined) {
    return DEFAULT_ACTOR_INVOCATION_POLICY;
  }

  assertPlainClosedPolicy(input);
  const timeoutMilliseconds = readDataField(input, 'timeoutMilliseconds');

  if (
    timeoutMilliseconds !== null &&
    (typeof timeoutMilliseconds !== 'number' ||
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds <= 0 ||
      timeoutMilliseconds > MAX_ACTOR_INVOCATION_TIMEOUT_MILLISECONDS)
  ) {
    throw invalidPolicy(
      `timeoutMilliseconds must be null or a positive integer no greater than ${MAX_ACTOR_INVOCATION_TIMEOUT_MILLISECONDS}`
    );
  }

  return Object.freeze({ timeoutMilliseconds });
}

function assertPlainClosedPolicy(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidPolicy('policy must be a plain object');
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidPolicy('policy must be a plain object');
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (!POLICY_KEYS.has(key)) {
      throw invalidPolicy(`policy contains unknown field ${String(key)}`);
    }
  }

  if (!keys.includes('timeoutMilliseconds')) {
    throw invalidPolicy('policy must define timeoutMilliseconds');
  }
}

function readDataField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalidPolicy(`${key} must be an enumerable data property`);
  }

  return descriptor.value;
}

function invalidPolicy(message: string): AgentActorError {
  return new AgentActorError(
    'ACTOR_DEFINITION_INVALID',
    `Invalid Actor invocation policy: ${message}`
  );
}
