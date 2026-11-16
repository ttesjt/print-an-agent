import { expect, it, vi } from 'vitest';
import { skipWorkflow, type WorkflowEvent } from '@print-an-agent/workflow-core';
import { options, workflow } from '../support/fixtures.js';

it.each(['A', 'DOMAIN_ERROR_12', 'A'.repeat(128)])('accepts the bounded code %s', async (code) => {
  const original = new Error('private');
  const events: WorkflowEvent[] = [];
  await expect(
    workflow(() => {
      throw original;
    }).run({
      ...options(),
      classifyFailure: () => code,
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).rejects.toBe(original);
  expect(events.filter((event) => event.type.endsWith('failed'))).toEqual([
    expect.objectContaining({ errorCode: code }),
    expect.objectContaining({ errorCode: code }),
  ]);
});

const invalid: readonly (readonly [string, () => unknown])[] = [
  ['empty', () => ''],
  ['too long', () => 'A'.repeat(129)],
  ['lowercase', () => 'private_message'],
  ['leading digit', () => '1_CODE'],
  ['space', () => 'PRIVATE MESSAGE'],
  ['control character', () => 'CODE\u001b'],
  ['newline', () => 'CODE\n'],
  ['carriage return', () => 'CODE\r'],
  ['unicode separator', () => 'CODE\u2028'],
  ['non-ASCII', () => '错误'],
  ['undefined', () => undefined],
  ['null', () => null],
  ['number', () => 3],
  ['symbol', () => Symbol('private')],
  ['error object', () => new Error('private')],
  ['boxed string', () => new String('CODE')],
  ['array', () => ['CODE']],
  [
    'object with coercion',
    () => ({
      toString() {
        throw new Error('must not coerce');
      },
    }),
  ],
  ['resolved promise', () => Promise.resolve('CODE')],
  ['rejected promise', () => Promise.reject(new Error('classifier rejection'))],
  ['stalled promise', () => new Promise<string>(() => undefined)],
  [
    'throwing then getter',
    () =>
      Object.defineProperty({}, 'then', {
        get() {
          throw new Error('classifier then');
        },
      }),
  ],
];

it.each(invalid)(
  'omits %s without coercion, waiting or changing the failure',
  async (_label, value) => {
    const original = new Error('work');
    const cleanup = vi.fn();
    const events: WorkflowEvent[] = [];
    const flow = workflow(
      () => {
        throw original;
      },
      { lifecycle: { onFinally: cleanup } }
    );
    await expect(
      flow.run({
        ...options(),
        // @ts-expect-error Exercise malformed JavaScript callers at the public boundary.
        classifyFailure: value,
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).rejects.toBe(original);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type.endsWith('failed'))).toHaveLength(2);
    expect(events.every((event) => !Object.hasOwn(event, 'errorCode'))).toBe(true);
    // Flush any invalid promise return so an unhandled rejection cannot escape this test.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
);

it('isolates a throwing classifier and a stalled observer from cleanup and failure', async () => {
  const original = new Error('work');
  const cleanup = vi.fn();
  const classifyFailure = vi.fn(() => {
    throw new Error('classifier');
  });
  const events: WorkflowEvent[] = [];
  await expect(
    workflow(
      () => {
        throw original;
      },
      { lifecycle: { onFinally: cleanup } }
    ).run({
      ...options(),
      classifyFailure,
      onEvent: (event) => {
        events.push(event);
        return new Promise<void>(() => undefined);
      },
    })
  ).rejects.toBe(original);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(classifyFailure).toHaveBeenCalledTimes(2);
  expect(events.every((event) => !Object.hasOwn(event, 'errorCode'))).toBe(true);
});

it('never reads raw error fields without an explicit classifier', async () => {
  const readCode = vi.fn(() => 'DO_NOT_READ');
  const original = Object.defineProperty(new Error('private'), 'code', { get: readCode });
  const events: WorkflowEvent[] = [];
  await expect(
    workflow(() => {
      throw original;
    }).run({
      ...options(),
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).rejects.toBe(original);
  expect(readCode).not.toHaveBeenCalled();
  expect(events.every((event) => !Object.hasOwn(event, 'errorCode'))).toBe(true);
});

it('does not classify unobserved failures, successful work or condition skips', async () => {
  const classifyFailure = vi.fn(() => 'UNUSED');
  const run = { ...options(), classifyFailure };
  const original = new Error('work');
  await expect(
    workflow(() => {
      throw original;
    }).run(run)
  ).rejects.toBe(original);
  await workflow(() => Promise.resolve()).run({ ...run, onEvent: () => undefined });
  await workflow(() => Promise.resolve(), {
    condition: () => skipWorkflow('not needed'),
    createSkippedResult: () => [],
  }).run({
    ...run,
    onEvent: () => undefined,
  });
  expect(classifyFailure).not.toHaveBeenCalled();
});
