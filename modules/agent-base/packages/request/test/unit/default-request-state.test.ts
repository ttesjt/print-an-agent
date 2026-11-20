import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { expect, expectTypeOf, it } from 'vitest';
import {
  createDefaultRequestState,
  type RequestWorkflowInput,
  type RequestWorkflowState,
} from '../../src/index.js';

it('selects only declared request data without retaining an execution context', () => {
  const input = {
    agentId: parseAgentId('independent'),
    requestId: 'request',
    requestInput: { message: 'hello' },
    signal: new AbortController().signal,
    operations: { invoke: () => Promise.reject(new Error('Must not be retained.')) },
    output: 'unrelated output',
  };
  const state = createDefaultRequestState(input);
  expect(state).toEqual({
    agentId: input.agentId,
    requestId: 'request',
    requestInput: input.requestInput,
  });
  expect(state).not.toBe(input);
  expect(state).not.toHaveProperty('signal');
  expect(state).not.toHaveProperty('operations');
  expect(state).not.toHaveProperty('output');
  expect(state).not.toHaveProperty('traceEmitter');
  expectTypeOf<RequestWorkflowState>().not.toHaveProperty('agentRun');
  expectTypeOf<RequestWorkflowState>().not.toHaveProperty('signal');
});

it('creates fresh working state on every invocation without mutating borrowed input', () => {
  const input: RequestWorkflowInput = Object.freeze({
    agentId: parseAgentId('independent'),
    requestId: 'request',
    requestInput: Object.freeze({ message: 'hello' }),
  });
  const first = createDefaultRequestState(input);
  const second = createDefaultRequestState(input);
  first.instructions = 'first only';
  expect(second.instructions).toBeUndefined();
  expect(first).not.toBe(second);
  expect(first.requestInput).toBe(input.requestInput);
  expect(input).not.toHaveProperty('instructions');
});
