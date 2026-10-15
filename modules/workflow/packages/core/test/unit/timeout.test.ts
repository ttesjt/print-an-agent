import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isExecutionTimeoutFailure,
  MAX_EXECUTION_TIMEOUT_MILLISECONDS,
  NO_EXECUTION_TIMEOUT,
  runWithExecutionTimeout,
  type ExecutionTimeoutMilliseconds,
} from '@ta-agent/workflow-core';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('execution timeout', () => {
  it('adds no cancellation resources when the local timeout is disabled', async () => {
    const parent = new AbortController();
    const addListener = vi.spyOn(parent.signal, 'addEventListener');
    let receivedSignal: AbortSignal | undefined;

    await expect(
      runWithExecutionTimeout(
        { parentSignal: parent.signal, timeoutMilliseconds: NO_EXECUTION_TIMEOUT },
        (signal) => {
          receivedSignal = signal;
          return Promise.resolve('completed');
        }
      )
    ).resolves.toBe('completed');

    expect(receivedSignal).toBe(parent.signal);
    expect(addListener).not.toHaveBeenCalled();
  });

  it('aborts actual work and returns a branded local timeout failure', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const execution = runWithExecutionTimeout(
      { parentSignal: parent.signal, timeoutMilliseconds: 25 },
      (signal) => {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('Execution aborted.', { cause: signal.reason })
              ),
            { once: true }
          );
        });
      }
    );
    const checked = expect(execution).rejects.toSatisfy((error: unknown) => {
      expect(isExecutionTimeoutFailure(error)).toBe(true);
      if (!isExecutionTimeoutFailure(error)) return false;
      expect(error).toMatchObject({
        name: 'ExecutionTimeoutError',
        code: 'EXECUTION_TIMEOUT',
        timeoutMilliseconds: 25,
      });
      return true;
    });

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(25);

    await checked;
    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toBeInstanceOf(DOMException);
    expect(receivedSignal?.reason).toMatchObject({ name: 'TimeoutError' });
    expect(parent.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the creating boundary map only its own deadline into a domain failure', async () => {
    vi.useFakeTimers();
    const domainFailure = new Error('request execution timed out');
    let mappings = 0;
    const execution = runWithExecutionTimeout(
      {
        parentSignal: new AbortController().signal,
        timeoutMilliseconds: 25,
        createTimeoutFailure: ({ timeoutMilliseconds, cause }) => {
          mappings++;
          expect(timeoutMilliseconds).toBe(25);
          expect(cause).toBeInstanceOf(DOMException);
          return domainFailure;
        },
      },
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('Execution aborted.', { cause: signal.reason })
              ),
            { once: true }
          );
        })
    );
    const checked = expect(execution).rejects.toBe(domainFailure);

    await vi.advanceTimersByTimeAsync(25);

    await checked;
    expect(isExecutionTimeoutFailure(domainFailure)).toBe(false);
    expect(mappings).toBe(1);
  });

  it('preserves parent cancellation without relabeling it as a local timeout', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const parentFailure = new Error('caller cancelled');
    const execution = runWithExecutionTimeout(
      { parentSignal: parent.signal, timeoutMilliseconds: 25 },
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('Execution aborted.', { cause: signal.reason })
              ),
            { once: true }
          );
        })
    );
    const checked = expect(execution).rejects.toBe(parentFailure);

    parent.abort(parentFailure);

    await checked;
    expect(isExecutionTimeoutFailure(parentFailure)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans its timer and leaves its effective signal live when work finishes early', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    await expect(
      runWithExecutionTimeout(
        { parentSignal: parent.signal, timeoutMilliseconds: 25 },
        (signal) => {
          receivedSignal = signal;
          return Promise.resolve('completed');
        }
      )
    ).resolves.toBe('completed');

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(25);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('cannot be converted into success by work that settles after its signal aborts', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    let complete: (() => void) | undefined;
    const execution = runWithExecutionTimeout(
      { parentSignal: parent.signal, timeoutMilliseconds: 25 },
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const checked = expect(execution).rejects.toSatisfy(isExecutionTimeoutFailure);

    await vi.advanceTimersByTimeAsync(25);
    complete?.();

    await checked;
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_EXECUTION_TIMEOUT_MILLISECONDS + 1])(
    'rejects invalid timeout value %s before starting work',
    async (timeoutMilliseconds) => {
      let started = false;

      await expect(
        runWithExecutionTimeout(
          {
            parentSignal: new AbortController().signal,
            timeoutMilliseconds: timeoutMilliseconds as ExecutionTimeoutMilliseconds,
          },
          () => {
            started = true;
            return Promise.resolve();
          }
        )
      ).rejects.toBeInstanceOf(RangeError);
      expect(started).toBe(false);
    }
  );
});
