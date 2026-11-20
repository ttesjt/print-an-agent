import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('allows one compaction leaf Step to be replaced without invoking its Actor', async () => {
  let requestSequence = 0;
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => `override-${++requestSequence}`,
    sessionCompactionStepOverrides: {
      buildCompactedContext: (context) => {
        context.state.compactedContext = Object.freeze({
          role: 'context',
          text: 'replacement context',
          timestamp: 50,
        });
        return Promise.resolve();
      },
    },
    provider: {
      responses: [
        { status: 'success', text: 'one' },
        { status: 'success', text: 'two' },
        { status: 'success', text: 'three' },
        { status: 'success', text: 'four' },
      ],
    },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });
  for (const message of ['one', 'two', 'three', 'four']) {
    await agent.run({ message, sessionId: sessionId });
  }
  await expect(agent.compactSession({ sessionId: sessionId })).resolves.toMatchObject({
    status: 'compacted',
    revision: 1,
  });
  expect(agent.inspectDeterministicProvider().callCount).toBe(4);
});
