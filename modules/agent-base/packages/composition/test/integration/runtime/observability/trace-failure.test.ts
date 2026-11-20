import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('isolates a failed trace sink from the assembled request result', async () => {
  const observedFailures: string[] = [];
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    observability: {
      sink: { record: () => Promise.reject(new Error('trace unavailable')) },
      onSinkFailure: (failure) => {
        observedFailures.push(failure.event.type);
        return Promise.resolve();
      },
    },
    provider: { responses: [{ status: 'success', text: 'still succeeds' }] },
  });

  await expect(agent.run({ message: 'hello' })).resolves.toMatchObject({
    message: { text: 'still succeeds' },
  });
  expect(observedFailures.at(0)).toBe('agent-run-started');
  expect(observedFailures.at(-1)).toBe('agent-run-completed');
});
