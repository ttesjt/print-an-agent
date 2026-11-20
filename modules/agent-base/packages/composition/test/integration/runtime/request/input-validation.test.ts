import { AgentRequestError } from '@print-an-agent/base-request';
import { AgentSessionError } from '@print-an-agent/base-session';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('fails invalid request input before invoking Pi', async () => {
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    provider: { responses: [{ status: 'success', text: 'unused' }] },
  });

  await expect(agent.run({ message: '   ' })).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_INPUT_INVALID' })
  );
  await expect(agent.run({ message: 'hello', sessionId: 'invalid session' })).rejects.toEqual(
    expect.objectContaining({ code: 'SESSION_ID_INVALID' })
  );
  await expect(agent.run({ message: 'hello', idempotencyKey: 'missing-session' })).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_INPUT_INVALID' })
  );
  expect(agent.inspectDeterministicProvider().callCount).toBe(0);

  let compactionConfigurationError: unknown;
  try {
    createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      sessionCompactionInstructions: '   ',
      provider: { responses: [{ status: 'success', text: 'unused' }] },
    });
  } catch (error: unknown) {
    compactionConfigurationError = error;
  }
  expect(compactionConfigurationError).toEqual(
    expect.objectContaining<Partial<AgentSessionError>>({
      code: 'SESSION_COMPACTION_INVALID',
    })
  );
});
