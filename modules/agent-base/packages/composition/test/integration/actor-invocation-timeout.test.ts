import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../src/index.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Actor invocation timeout composition', () => {
  it('forwards the TypeScript main Actor policy without turning it into Request policy', async () => {
    vi.useFakeTimers();
    const response = Promise.withResolvers<{
      readonly status: 'success';
      readonly text: string;
    }>();
    const providerStarted = Promise.withResolvers<void>();
    const agent = createDeterministicAgentAPI({
      identity: { id: 'actor-timeout-agent' },
      mainActor: { invocationPolicy: { timeoutMilliseconds: 25 } },
      provider: {
        responses: [
          () => {
            providerStarted.resolve();
            return response.promise;
          },
        ],
      },
    });

    const run = agent.run({ message: 'wait for the model' });
    const expectation = expect(run).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await providerStarted.promise;
    await vi.advanceTimersByTimeAsync(25);
    response.resolve({ status: 'success', text: 'late response' });

    await expectation;
    expect(agent.inspectDeterministicProvider().callCount).toBe(1);
    expect(agent.agent.operations.foreground.config.timeoutMilliseconds).toBeNull();
  });
});
