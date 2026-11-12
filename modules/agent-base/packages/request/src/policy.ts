import type { RequestPolicy } from './contracts.js';
import { AgentRequestError } from './errors.js';
import {
  MAX_EXECUTION_TIMEOUT_MILLISECONDS,
  NO_EXECUTION_TIMEOUT,
} from '@print-an-agent/workflow-core';

export const NO_REQUEST_TIMEOUT = NO_EXECUTION_TIMEOUT;

export const DEFAULT_REQUEST_POLICY: RequestPolicy = Object.freeze({
  maxMessageCharacters: 32_000,
  maxInstructionsCharacters: 32_000,
  maxOutputCharacters: 64_000,
  maxReasoningCharacters: 64_000,
  maxModelTurns: 4,
  maxPendingInteractionEvents: 64,
  timeoutMilliseconds: NO_REQUEST_TIMEOUT,
});

const REQUEST_POLICY_KEYS = Object.freeze([
  'maxMessageCharacters',
  'maxInstructionsCharacters',
  'maxOutputCharacters',
  'maxReasoningCharacters',
  'maxModelTurns',
  'maxPendingInteractionEvents',
  'timeoutMilliseconds',
] as const);

function invalidPolicy(message: string): never {
  throw new AgentRequestError('REQUEST_POLICY_INVALID', message);
}

function isRequestPolicyKey(key: string): key is (typeof REQUEST_POLICY_KEYS)[number] {
  return REQUEST_POLICY_KEYS.some((candidate) => candidate === key);
}

function parsePolicyValue(
  policy: Readonly<Record<string, unknown>>,
  name: (typeof REQUEST_POLICY_KEYS)[number]
): number {
  const descriptor = Object.getOwnPropertyDescriptor(policy, name);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    invalidPolicy(`Request policy "${name}" must be an enumerable data field.`);
  }
  const value: unknown = descriptor.value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalidPolicy(`Request policy "${name}" is outside its supported positive integer range.`);
  }
  return value;
}

function parseTimeoutMilliseconds(
  policy: Readonly<Record<string, unknown>>
): RequestPolicy['timeoutMilliseconds'] {
  const descriptor = Object.getOwnPropertyDescriptor(policy, 'timeoutMilliseconds');
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    invalidPolicy('Request policy "timeoutMilliseconds" must be an enumerable data field.');
  }
  const value: unknown = descriptor.value;
  if (value === NO_REQUEST_TIMEOUT) return NO_REQUEST_TIMEOUT;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_EXECUTION_TIMEOUT_MILLISECONDS
  ) {
    invalidPolicy(
      'Request policy "timeoutMilliseconds" must be null or a supported positive integer.'
    );
  }
  return value;
}

export function validateRequestPolicy(input: unknown): RequestPolicy {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalidPolicy('Request policy must be a plain object.');
  }
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    invalidPolicy('Request policy must be a plain object.');
  }
  const policy = input as Readonly<Record<string, unknown>>;
  const actualKeys = Reflect.ownKeys(policy);
  if (
    actualKeys.length !== REQUEST_POLICY_KEYS.length ||
    actualKeys.some((key) => typeof key !== 'string' || !isRequestPolicyKey(key))
  ) {
    invalidPolicy('Request policy contains missing or unsupported fields.');
  }
  return Object.freeze({
    maxMessageCharacters: parsePolicyValue(policy, 'maxMessageCharacters'),
    maxInstructionsCharacters: parsePolicyValue(policy, 'maxInstructionsCharacters'),
    maxOutputCharacters: parsePolicyValue(policy, 'maxOutputCharacters'),
    maxReasoningCharacters: parsePolicyValue(policy, 'maxReasoningCharacters'),
    maxModelTurns: parsePolicyValue(policy, 'maxModelTurns'),
    maxPendingInteractionEvents: parsePolicyValue(policy, 'maxPendingInteractionEvents'),
    timeoutMilliseconds: parseTimeoutMilliseconds(policy),
  });
}
