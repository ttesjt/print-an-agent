import { defineModelMessage, type ModelMessage } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../errors.js';
import { DEFAULT_REQUEST_POLICY } from '../policy.js';
import type { SessionlessGenerationPolicy } from './contracts.js';

export const DEFAULT_SESSIONLESS_GENERATION_POLICY: SessionlessGenerationPolicy = Object.freeze({
  maxMessageCharacters: DEFAULT_REQUEST_POLICY.maxMessageCharacters,
  maxContextCharacters: 256_000,
  maxContextMessages: 256,
  maxInstructionsCharacters: DEFAULT_REQUEST_POLICY.maxInstructionsCharacters,
  maxOutputCharacters: DEFAULT_REQUEST_POLICY.maxOutputCharacters,
  maxReasoningCharacters: DEFAULT_REQUEST_POLICY.maxReasoningCharacters,
  maxPendingInteractionEvents: DEFAULT_REQUEST_POLICY.maxPendingInteractionEvents,
});

export function closedRecord(
  input: unknown,
  keys: readonly string[],
  code: 'REQUEST_INPUT_INVALID' | 'REQUEST_CONFIGURATION_INVALID' | 'REQUEST_POLICY_INVALID'
): Readonly<Record<string, unknown>> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new AgentRequestError(code, 'Request boundary requires a plain record.');
  }
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      !keys.includes(key) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new AgentRequestError(
        code,
        'Request boundary contains an unsupported field or accessor.'
      );
    }
  }
  return input as Readonly<Record<string, unknown>>;
}

export function defineSessionlessGenerationPolicy(
  input: unknown = {}
): SessionlessGenerationPolicy {
  const overrides = closedRecord(
    input,
    Object.keys(DEFAULT_SESSIONLESS_GENERATION_POLICY),
    'REQUEST_POLICY_INVALID'
  );
  const policy = { ...DEFAULT_SESSIONLESS_GENERATION_POLICY, ...overrides };
  for (const value of Object.values(policy)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new AgentRequestError(
        'REQUEST_POLICY_INVALID',
        'Sessionless limits must be positive safe integers.'
      );
    }
  }
  return Object.freeze(policy);
}

/** Core owns each message protocol. This boundary owns collection size and text budgets only. */
export function prepareSessionlessMessages(
  history: unknown,
  maxCharacters: number,
  maxMessages: number
): readonly ModelMessage[] {
  if (!Array.isArray(history))
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Request history must be an array.');
  const messages: ModelMessage[] = [];
  let characters = 0;
  // Collection metadata also consumes the budget, including arrays of empty messages.
  if (history.length > maxMessages)
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      'Request context exceeds its collection budget.'
    );
  for (let index = 0; index < history.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(history, index);
    if (descriptor === undefined || !('value' in descriptor))
      throw new AgentRequestError(
        'REQUEST_INPUT_INVALID',
        'Request history must contain data entries.'
      );
    const message = defineModelMessage(descriptor.value);
    characters += message.text.length;
    if (characters > maxCharacters)
      throw new AgentRequestError(
        'REQUEST_INPUT_INVALID',
        'Request context exceeds its character budget.'
      );
    messages.push(message);
  }
  return Object.freeze(messages);
}
