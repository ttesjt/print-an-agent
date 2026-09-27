import {
  AgentRequestError,
  DEFAULT_REQUEST_POLICY,
  NO_REQUEST_TIMEOUT,
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
      timeoutMilliseconds: NO_REQUEST_TIMEOUT,
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
    { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 0 },
    { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: -1 },
    { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 1.5 },
    { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: undefined },
    { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 2_147_483_648 },
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

  it('accepts an explicit bounded Request timeout', () => {
    expect(
      validateRequestPolicy({ ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 120_000 })
        .timeoutMilliseconds
    ).toBe(120_000);
  });
});
