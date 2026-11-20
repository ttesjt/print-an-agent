import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('propagates an individual Step override through the unchanged request composition', async () => {
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    provider: {
      responses: [(request) => ({ status: 'success', text: request.instructions })],
    },
    stepOverrides: {
      resolveInstructions: (context) => {
        context.state.instructions = 'Overridden instructions.';
        return Promise.resolve();
      },
    },
  });

  const response = await agent.run({ message: 'hello' });
  expect(response.message.text).toBe('Overridden instructions.');
  expect(agent.inspectDeterministicProvider().requests[0]?.instructions).toBe(
    'Overridden instructions.'
  );
});
