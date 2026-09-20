import {
  AgentRequestError,
  DEFAULT_REQUEST_POLICY,
  validateRequestPolicy,
} from '../../src/index.js';
import { describe, expect, it } from 'vitest';

describe('Request policy', () => {
  it('normalizes the closed model-turn policy', () => {
    const policy = validateRequestPolicy({ ...DEFAULT_REQUEST_POLICY, maxModelTurns: 2 });

    expect(policy).toEqual({
      maxMessageCharacters: 32_000,
      maxInstructionsCharacters: 32_000,
      maxOutputCharacters: 64_000,
      maxReasoningCharacters: 64_000,
      maxModelTurns: 2,
      maxPendingInteractionEvents: 64,
      timeoutMilliseconds: 30_000,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it.each([
    null,
    { ...DEFAULT_REQUEST_POLICY, maxModelTurns: 0 },
    { ...DEFAULT_REQUEST_POLICY, maxModelTurns: 1.5 },
    { ...DEFAULT_REQUEST_POLICY, maxModelTurns: undefined },
    { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: 0 },
    { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: -1 },
    { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: 1.5 },
    { ...DEFAULT_REQUEST_POLICY, maxReasoningCharacters: undefined },
    { ...DEFAULT_REQUEST_POLICY, maxPendingInteractionEvents: 0 },
    { ...DEFAULT_REQUEST_POLICY, maxPendingInteractionEvents: 1.5 },
    { ...DEFAULT_REQUEST_POLICY, maxPendingInteractionEvents: undefined },
    { ...DEFAULT_REQUEST_POLICY, maxProviderTurns: 4 },
    {
      maxMessageCharacters: 32_000,
      maxInstructionsCharacters: 32_000,
      maxOutputCharacters: 64_000,
      maxProviderTurns: 4,
      timeoutMilliseconds: 30_000,
    },
  ])('rejects malformed, open, or obsolete policy %#', (policy) => {
    expect(() => validateRequestPolicy(policy)).toThrowError(AgentRequestError);
  });
});
