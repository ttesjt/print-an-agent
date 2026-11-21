import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/agent-actor';
import { MemoryAgentTraceAdapter } from '@print-an-agent/base-local-adapters';
import { AgentRequestError } from '@print-an-agent/base-request';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { expect, it } from 'vitest';
import { composeAgent, FOREGROUND_AGENT_OPERATION_NAME } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('applies the assembled request timeout and reports it distinctly', async () => {
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
  const actorCatalog = createAgentActorCatalog({
    actors: [{ id: MAIN_ACTOR_ID, engineId: 'waiting-engine' }],
    engines: [
      {
        id: 'waiting-engine',
        capabilities: {
          invocationModes: ['interaction'],
          inputMediaTypes: ['text'],
          interaction: { streamable: true },
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        interact: (request) =>
          new Promise((_resolve, reject) => {
            const rejectForAbort = () => {
              const timedOut =
                request.signal.reason instanceof DOMException &&
                request.signal.reason.name === 'TimeoutError';
              reject(
                new ModelInvocationError(
                  timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
                  timedOut ? 'timed out' : 'cancelled'
                )
              );
            };
            if (request.signal.aborted) rejectForAbort();
            else request.signal.addEventListener('abort', rejectForAbort, { once: true });
          }),
      },
    ],
  });
  const agent = composeAgent({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => 'timeout-run',
    actorCatalog,
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
    observability: { sink: trace, clock: () => 1 },
    requestPolicy: {
      maxMessageCharacters: 100,
      maxInstructionsCharacters: 100,
      maxOutputCharacters: 100,
      maxModelTurns: 4,
      maxPendingInteractionEvents: 64,
      maxReasoningCharacters: 64_000,
      timeoutMilliseconds: 5,
    },
  });

  await expect(agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, { message: 'wait' })).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_TIMEOUT' })
  );
  const serializedTrace = JSON.stringify(trace.inspect({ agentRunId: 'timeout-run' }).events);
  expect(serializedTrace).toContain('MODEL_INVOCATION_TIMEOUT');
  expect(serializedTrace).not.toContain('timed out');
});
