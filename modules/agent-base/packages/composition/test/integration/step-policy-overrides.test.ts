import { STEP_CARDINALITY } from '@ta-agent/base-workflow';
import { describe, expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../src/index.js';

describe('composed Step policy overrides', () => {
  it('retains default implementations and optional skips across all official Operations', async () => {
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
      sessionNavigationStepOverrides: {
        inspectSessionNavigation: { cardinality: STEP_CARDINALITY.REPEATABLE },
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
    for (const message of ['one', 'two', 'three', 'four']) {
      await expect(agent.run({ message, sessionId: 'conversation' })).resolves.toMatchObject({
        message: { text: message },
      });
    }
    await expect(agent.compactSession({ sessionId: 'conversation' })).resolves.toMatchObject({
      status: 'compacted',
    });
    await expect(
      agent.navigateSession({ operation: 'inspect', sessionId: 'conversation' })
    ).resolves.toMatchObject({ status: 'inspected' });
    expect(agent.inspectDeterministicProvider().callCount).toBe(5);
  });
});
