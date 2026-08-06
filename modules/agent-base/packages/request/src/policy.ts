import type { RequestPolicy } from './contracts.js';
import { AgentRequestError } from './errors.js';

export const DEFAULT_REQUEST_POLICY: RequestPolicy = Object.freeze({
  maxMessageCharacters: 32_000,
  maxInstructionsCharacters: 32_000,
  maxOutputCharacters: 64_000,
  timeoutMilliseconds: 30_000,
});

const MAX_TIMEOUT_MILLISECONDS = 2_147_483_647;

export function validateRequestPolicy(policy: RequestPolicy): RequestPolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      (name === 'timeoutMilliseconds' && value > MAX_TIMEOUT_MILLISECONDS)
    ) {
      throw new AgentRequestError(
        'REQUEST_POLICY_INVALID',
        `Request policy "${name}" is outside its supported positive integer range.`
      );
    }
  }
  return Object.freeze({ ...policy });
}
