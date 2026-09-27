import { AgentModelError } from './errors.js';

export const NO_PROVIDER_TRANSPORT_TIMEOUT = null;
export const MAX_PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS = 2_147_483_647;

export type ProviderTransportTimeoutMilliseconds = number | null;

export interface ProviderTransportLivenessPolicyInput {
  readonly responseStartTimeoutMilliseconds: ProviderTransportTimeoutMilliseconds;
  readonly streamEventIdleTimeoutMilliseconds: ProviderTransportTimeoutMilliseconds;
}

export interface ProviderTransportLivenessPolicy {
  readonly responseStartTimeoutMilliseconds: ProviderTransportTimeoutMilliseconds;
  readonly streamEventIdleTimeoutMilliseconds: ProviderTransportTimeoutMilliseconds;
}

export const DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY: ProviderTransportLivenessPolicy =
  Object.freeze({
    responseStartTimeoutMilliseconds: NO_PROVIDER_TRANSPORT_TIMEOUT,
    streamEventIdleTimeoutMilliseconds: NO_PROVIDER_TRANSPORT_TIMEOUT,
  });

const POLICY_KEYS = [
  'responseStartTimeoutMilliseconds',
  'streamEventIdleTimeoutMilliseconds',
] as const;

export function defineProviderTransportLivenessPolicy(
  input: ProviderTransportLivenessPolicyInput | undefined
): ProviderTransportLivenessPolicy {
  if (input === undefined) return DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY;

  assertClosedPolicy(input);
  return Object.freeze({
    responseStartTimeoutMilliseconds: parseTimeout(input, 'responseStartTimeoutMilliseconds'),
    streamEventIdleTimeoutMilliseconds: parseTimeout(input, 'streamEventIdleTimeoutMilliseconds'),
  });
}

function assertClosedPolicy(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidPolicy('policy must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidPolicy('policy must be a plain object');
  }
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (!POLICY_KEYS.some((candidate) => candidate === key)) {
      throw invalidPolicy(`policy contains unknown field ${String(key)}`);
    }
  }
  for (const key of POLICY_KEYS) {
    if (!keys.includes(key)) throw invalidPolicy(`policy must define ${String(key)}`);
  }
}

function parseTimeout(
  input: Readonly<Record<string, unknown>>,
  key: keyof ProviderTransportLivenessPolicy
): ProviderTransportTimeoutMilliseconds {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw invalidPolicy(`${key} must be an enumerable data property`);
  }
  const value: unknown = descriptor.value;
  if (value === NO_PROVIDER_TRANSPORT_TIMEOUT) return NO_PROVIDER_TRANSPORT_TIMEOUT;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS
  ) {
    throw invalidPolicy(
      `${key} must be null or a positive integer no greater than ${MAX_PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS}`
    );
  }
  return value;
}

function invalidPolicy(message: string): AgentModelError {
  return new AgentModelError(
    'MODEL_PROVIDER_TRANSPORT_POLICY_INVALID',
    `Invalid provider transport liveness policy: ${message}.`
  );
}
