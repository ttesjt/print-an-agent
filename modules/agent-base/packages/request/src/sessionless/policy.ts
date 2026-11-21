import { AgentRequestError } from '../errors.js';
import { DEFAULT_REQUEST_POLICY } from '../policy/index.js';
import { closedRecord } from './configuration.js';
import type { SessionlessPolicy } from './types/policy.js';
export const DEFAULT_SESSIONLESS_POLICY: SessionlessPolicy = Object.freeze({
  maxMessageCharacters: DEFAULT_REQUEST_POLICY.maxMessageCharacters,
  maxContextCharacters: 256_000,
  maxContextMessages: 256,
  maxInstructionsCharacters: DEFAULT_REQUEST_POLICY.maxInstructionsCharacters,
  maxOutputCharacters: DEFAULT_REQUEST_POLICY.maxOutputCharacters,
  maxReasoningCharacters: DEFAULT_REQUEST_POLICY.maxReasoningCharacters,
  maxPendingInteractionEvents: DEFAULT_REQUEST_POLICY.maxPendingInteractionEvents,
});

export function defineSessionlessPolicy(input: unknown = {}): SessionlessPolicy {
  const overrides = closedRecord(
    input,
    Object.keys(DEFAULT_SESSIONLESS_POLICY),
    'REQUEST_POLICY_INVALID'
  );
  const policy = { ...DEFAULT_SESSIONLESS_POLICY, ...overrides };
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
