import { expect, it } from 'vitest';
import {
  failureDetails,
  restoreFailures,
  readWorkerRequest,
  readWorkerMessage,
  isReplyFor,
} from '../../../src/worker/protocol/index.js';

it('checks private message envelopes and operation arities', () => {
  const cancellation = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  expect(
    readWorkerRequest({ id: 1, operation: 'get', args: ['m', 'e'], cancellation })
  ).toMatchObject({ operation: 'get', args: ['m', 'e'] });
  for (const value of [
    null,
    { id: 1, operation: 'get', args: ['m'], cancellation },
    { id: 1, operation: 'unknown', args: [], cancellation },
    { id: 1, operation: 'close', args: [], cancellation: new SharedArrayBuffer(0) },
  ])
    expect(() => readWorkerRequest(value)).toThrow('Invalid private SQLite worker message.');
  expect(readWorkerMessage({ ready: true })).toEqual({ ready: true });
  const reply = { id: 1, operation: 'inspect', value: undefined } as const;
  expect(readWorkerMessage(reply)).toEqual(reply);
  expect(isReplyFor(reply, 'inspect')).toBe(true);
  expect(isReplyFor(reply, 'close')).toBe(false);
  for (const value of [
    null,
    { id: 1, value: undefined },
    { id: 1, operation: 'unknown', value: null },
    { id: 1, error: { code: 'STORAGE_FAILED', message: 'failure', causes: [null] } },
  ])
    expect(() => readWorkerMessage(value)).toThrow('Invalid private SQLite worker message.');
});

it('retains stacks and independent failures through diagnostic transport', () => {
  const commit = new Error('COMMIT failed');
  commit.stack = 'original COMMIT stack';
  const rollback = new Error('ROLLBACK failed');
  rollback.stack = 'original ROLLBACK stack';
  const details = failureDetails(new AggregateError([commit, rollback], 'transaction failed'));
  expect(restoreFailures(details)).toMatchObject({
    errors: [
      { name: 'AggregateError', message: 'transaction failed' },
      { name: 'Error', message: 'COMMIT failed', stack: 'original COMMIT stack' },
      { name: 'Error', message: 'ROLLBACK failed', stack: 'original ROLLBACK stack' },
    ],
  });
  expect(restoreFailures(failureDetails(undefined))).toBeUndefined();
});
