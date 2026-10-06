import { STEP_CARDINALITY } from '@ta-agent/base-workflow';
import { describe, expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../src/index.js';

describe('composed Step policy overrides', () => {
  it('retains default implementations and optional skips across official runtime Operations', async () => {
    let sequence = 0;
    const agent = createDeterministicAgentAPI({
      identity: { id: 'policy-agent' },
      createRunId: () => `run-${++sequence}`,
      stepOverrides: {
        resolveSession: { cardinality: STEP_CARDINALITY.REPEATABLE },
        gatherExternalContext: { cardinality: STEP_CARDINALITY.REPEATABLE },
      },
      sessionCompactionStepOverrides: {
        buildCompactedContext: { cardinality: STEP_CARDINALITY.REPEATABLE },
      },
      provider: {
        responses: [
          { status: 'success', text: 'one' },
          { status: 'success', text: 'two' },
          { status: 'success', text: 'three' },
          { status: 'success', text: 'four' },
          { status: 'success', text: 'summary' },
        ],
      },
    });
    const { sessionId } = await agent.agent.resources.session.resolve({
      agentId: agent.identity.id,
    });
    for (const message of ['one', 'two', 'three', 'four']) {
      await expect(agent.run({ message, sessionId: sessionId })).resolves.toMatchObject({
        message: { text: message },
      });
    }
    await expect(agent.compactSession({ sessionId: sessionId })).resolves.toMatchObject({
      status: 'compacted',
    });
    expect(agent.inspectDeterministicProvider().callCount).toBe(5);
  });
});
