import { describe, expect, it } from 'vitest';
import { traceErrorCode, validateAgentTraceEventDetails } from '../../../src/events/index.js';
import { AgentObservabilityError } from '../../../src/errors.js';

describe('Safe trace error codes', () => {
  it.each(['E', 'ERROR_42', 'X'.repeat(128)])(
    'uses the same structured-code rule for classification and events: %s',
    (code) => {
      expect(traceErrorCode({ code, message: 'private' })).toBe(code);
      expect(() =>
        validateAgentTraceEventDetails({
          type: 'agent-run-failed',
          operationName: 'test',
          errorCode: code,
        })
      ).not.toThrow();
    }
  );

  it.each(['', 'lowercase', 'ERROR WITH SPACE', 'X'.repeat(129), 42, null, undefined])(
    'rejects unsupported codes without copying exception messages: %j',
    (code) => {
      expect(traceErrorCode({ code, message: 'private' })).toBe('UNEXPECTED_ERROR');
      expect(() =>
        validateAgentTraceEventDetails({
          type: 'agent-run-failed',
          operationName: 'test',
          errorCode: code,
        })
      ).toThrowError(AgentObservabilityError);
    }
  );

  it('preserves the structured cause code through nested AggregateErrors', () => {
    const cause = Object.assign(new Error('private'), { code: 'REQUEST_FAILED' });
    const aggregate = new AggregateError([new Error('private cleanup')], 'private', {
      cause: new AggregateError([], 'private', { cause }),
    });
    expect(traceErrorCode(aggregate)).toBe('REQUEST_FAILED');
    expect(traceErrorCode(new Error('private'))).toBe('UNEXPECTED_ERROR');
    expect(traceErrorCode(null)).toBe('UNEXPECTED_ERROR');
  });
});
