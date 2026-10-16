import { describe, expect, it } from 'vitest';
import {
  ModelInvocationError,
  DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY,
  defineProviderTransportLivenessPolicy,
  MAX_PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS,
} from '../../../src/index.js';

function expectInvalidPolicy(input: unknown): void {
  let failure: unknown;
  try {
    defineProviderTransportLivenessPolicy(input as never);
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ModelInvocationError);
  if (failure instanceof ModelInvocationError) {
    expect(failure.code).toBe('MODEL_PROVIDER_TRANSPORT_POLICY_INVALID');
  }
}

describe('Provider transport liveness policy', () => {
  it('defaults every adapter-owned transport deadline to disabled', () => {
    expect(defineProviderTransportLivenessPolicy(undefined)).toBe(
      DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY
    );
    expect(DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY).toEqual({
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
    });
    expect(Object.isFrozen(DEFAULT_PROVIDER_TRANSPORT_LIVENESS_POLICY)).toBe(true);
  });

  it('normalizes and freezes explicit response-start and stream-event idle deadlines', () => {
    const policy = defineProviderTransportLivenessPolicy({
      responseStartTimeoutMilliseconds: 30_000,
      streamEventIdleTimeoutMilliseconds: 15_000,
    });

    expect(policy).toEqual({
      responseStartTimeoutMilliseconds: 30_000,
      streamEventIdleTimeoutMilliseconds: 15_000,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it.each([
    null,
    [],
    new (class Policy {})(),
    { responseStartTimeoutMilliseconds: null },
    { streamEventIdleTimeoutMilliseconds: null },
    {
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
      unsupported: true,
    },
  ])('rejects malformed or incomplete policy input %#', (input) => {
    expectInvalidPolicy(input);
  });

  it.each([0, -1, 1.5, MAX_PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS + 1, undefined])(
    'rejects an invalid transport timeout value of %s',
    (timeoutMilliseconds) => {
      expectInvalidPolicy({
        responseStartTimeoutMilliseconds: timeoutMilliseconds,
        streamEventIdleTimeoutMilliseconds: null,
      });
      expectInvalidPolicy({
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: timeoutMilliseconds,
      });
    }
  );

  it('rejects accessor-backed policy fields without evaluating them', () => {
    let evaluated = false;
    const input = {
      streamEventIdleTimeoutMilliseconds: null,
      get responseStartTimeoutMilliseconds() {
        evaluated = true;
        return null;
      },
    };

    expectInvalidPolicy(input);
    expect(evaluated).toBe(false);
  });
});
