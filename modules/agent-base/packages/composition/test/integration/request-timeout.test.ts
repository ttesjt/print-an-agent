import { AgentModelError } from '@ta-agent/base-model';
import { MemorySessionAdapter } from '@ta-agent/base-local-adapters';
import { DEFAULT_REQUEST_POLICY, NO_REQUEST_TIMEOUT } from '@ta-agent/base-request';
import { runWithExecutionTimeout } from '@ta-agent/base-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Request timeout', () => {
  it('does not impose an automatic deadline by default', async () => {
    vi.useFakeTimers();
    const fixture = await interactionAgent(async (request) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
      const message = interactionMessage('completed');
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });

    const run = fixture.run();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(run).resolves.toMatchObject({ message: { text: 'completed' } });
    expect(fixture.agent.operations.foreground.config.timeoutMilliseconds).toBe(NO_REQUEST_TIMEOUT);
  });

  it('maps only its configured local deadline to REQUEST_TIMEOUT', async () => {
    vi.useFakeTimers();
    let interactionSignal: AbortSignal | undefined;
    const fixture = await interactionAgent(
      (request) => {
        interactionSignal = request.signal;
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => {
              reject(
                new AgentModelError('MODEL_INVOCATION_TIMEOUT', 'Model invocation timed out.')
              );
            },
            { once: true }
          );
        });
      },
      {
        requestPolicy: { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 25 },
      }
    );

    const run = fixture.run();
    const checked = expect(run).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);

    await checked;
    expect(interactionSignal?.aborted).toBe(true);
    expect(interactionSignal?.reason).toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('does not relabel a caller-owned TimeoutError when no local deadline exists', async () => {
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    const callerFailure = new DOMException('Caller deadline expired.', 'TimeoutError');
    const fixture = await interactionAgent((request) => {
      started.resolve();
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () =>
            reject(
              request.signal.reason instanceof Error
                ? request.signal.reason
                : new Error('Request aborted.', { cause: request.signal.reason })
            ),
          { once: true }
        );
      });
    });

    const run = fixture.run(controller.signal);
    const checked = expect(run).rejects.toBe(callerFailure);
    await started.promise;
    controller.abort(callerFailure);

    await checked;
  });

  it('does not claim ownership of a narrower child execution timeout', async () => {
    vi.useFakeTimers();
    const fixture = await interactionAgent(() => Promise.reject(new Error('not reached')), {
      stepOverrides: {
        gatherExternalContext: (context) =>
          runWithExecutionTimeout(
            { parentSignal: context.signal, timeoutMilliseconds: 25 },
            (signal) =>
              new Promise((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () =>
                    reject(
                      signal.reason instanceof Error
                        ? signal.reason
                        : new Error('Child execution aborted.', { cause: signal.reason })
                    ),
                  { once: true }
                );
              })
          ),
      },
    });

    const run = fixture.run();
    const checked = expect(run).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({ code: 'EXECUTION_TIMEOUT' });
      expect(error).not.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      return true;
    });
    await vi.advanceTimersByTimeAsync(25);

    await checked;
  });

  it('reports timeout after a non-cancellable Session commit without hiding commit ambiguity', async () => {
    vi.useFakeTimers();
    const commitStarted = Promise.withResolvers<void>();
    const releaseCommit = Promise.withResolvers<void>();
    let turnCommitted = false;
    class DelayedSessionAdapter extends MemorySessionAdapter {
      override async completeTurn(
        request: Parameters<MemorySessionAdapter['completeTurn']>[0]
      ): Promise<Awaited<ReturnType<MemorySessionAdapter['completeTurn']>>> {
        const completed = await super.completeTurn(request);
        turnCommitted = true;
        commitStarted.resolve();
        await releaseCommit.promise;
        return completed;
      }
    }
    const session = new DelayedSessionAdapter({ createSessionId: () => 'session' });
    const fixture = await interactionAgent(
      async (request) => {
        const message = interactionMessage('completed');
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        session,
        requestPolicy: { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 25 },
      }
    );

    const run = fixture.run();
    const checked = expect(run).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await commitStarted.promise;
    await vi.advanceTimersByTimeAsync(25);
    releaseCommit.resolve();

    await checked;
    expect(turnCommitted).toBe(true);
  });

  it('reports timeout after a non-cancellable Output close without rewriting its committed state', async () => {
    vi.useFakeTimers();
    const closeStarted = Promise.withResolvers<void>();
    const releaseClose = Promise.withResolvers<void>();
    const fixture = await interactionAgent(
      async (request) => {
        const message = interactionMessage('completed');
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      {
        requestPolicy: { ...DEFAULT_REQUEST_POLICY, timeoutMilliseconds: 25 },
      }
    );
    const close = fixture.output.close.bind(fixture.output);
    vi.spyOn(fixture.output, 'close').mockImplementation(async (response) => {
      await close(response);
      closeStarted.resolve();
      await releaseClose.promise;
    });

    const run = fixture.run();
    const checked = expect(run).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await closeStarted.promise;
    await vi.advanceTimersByTimeAsync(25);
    releaseClose.resolve();

    await checked;
    expect(fixture.output.inspect()).toMatchObject({ status: 'closed' });
  });
});
