import {
  MemoryAgentTraceAdapter,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import { AgentRequestError, parseRequestIdempotencyKey } from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';
import {
  CancellingOutputSink,
  FailingCloseOutputSink,
  FailingFailureOutputSink,
  FailingWriteOutputSink,
  LifecycleRecordingOutputSink,
} from '../../../support/runtime/output-sinks.js';

it('propagates cancellation and fails the active Session turn and OutputSink', async () => {
  const session = new MemorySessionAdapter();
  const journal = new MemoryRequestJournalAdapter(() => 1);
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
  const controller = new AbortController();
  const sink = new CancellingOutputSink(controller);
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => 'cancelled-run',
    session,
    requestJournal: journal,
    observability: { sink: trace, clock: () => 1 },
    provider: {
      responses: [{ status: 'success', text: 'abcdefghij' }],
      charactersPerChunk: 1,
      tokensPerSecond: 1_000,
    },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });

  await expect(
    agent.run(
      {
        sessionId: sessionId,
        idempotencyKey: 'cancelled-request',
        message: 'start',
        outputSink: sink,
      },
      { signal: controller.signal }
    )
  ).rejects.toEqual(
    expect.objectContaining<Partial<ModelInvocationError>>({
      code: 'MODEL_INVOCATION_CANCELLED',
    })
  );
  expect(sink.inspect()).toMatchObject({
    status: 'failed',
    failure: { code: 'MODEL_INVOCATION_CANCELLED' },
  });
  const snapshot = await session.inspect({
    agentId: agent.identity.id,
    sessionId: parseSessionId(sessionId),
  });
  expect(snapshot?.turns[0]).toMatchObject({
    status: 'failed',
    failureCode: 'MODEL_INVOCATION_CANCELLED',
  });
  expect(
    await journal.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId(sessionId),
      idempotencyKey: parseRequestIdempotencyKey('cancelled-request'),
    })
  ).toMatchObject({
    status: 'failed',
    failure: { code: 'MODEL_INVOCATION_CANCELLED' },
  });
  expect(
    trace
      .inspect({ agentRunId: 'cancelled-run' })
      .events.find((event) => event.type === 'agent-loop-failed')
  ).toMatchObject({ errorCode: 'MODEL_INVOCATION_CANCELLED' });
});

it('preserves partial output while reporting provider failure', async () => {
  const sink = new LifecycleRecordingOutputSink();
  const journal = new MemoryRequestJournalAdapter(() => 1);
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => 'provider-failure-run',
    requestJournal: journal,
    observability: { sink: trace, clock: () => 1 },
    provider: {
      responses: [{ status: 'failure', message: 'provider unavailable', partialText: 'partial' }],
      charactersPerChunk: 3,
    },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });

  await expect(
    agent.run({
      sessionId: sessionId,
      idempotencyKey: 'failure-request',
      message: 'start',
      outputSink: sink,
    })
  ).rejects.toEqual(
    expect.objectContaining<Partial<ModelInvocationError>>({ code: 'MODEL_PROVIDER_FAILED' })
  );
  expect(sink.inspect()).toMatchObject({ status: 'failed' });
  expect(
    sink
      .inspect()
      .events.map((event) => event.delta)
      .join('')
  ).toBe('partial');
  expect(sink.calls.at(-1)).toBe('fail');
  expect(
    await journal.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId(sessionId),
      idempotencyKey: parseRequestIdempotencyKey('failure-request'),
    })
  ).toMatchObject({ status: 'failed', failure: { code: 'MODEL_PROVIDER_FAILED' } });
  const serializedTrace = JSON.stringify(
    trace.inspect({ agentRunId: 'provider-failure-run' }).events
  );
  expect(serializedTrace).toContain('MODEL_PROVIDER_FAILED');
  expect(serializedTrace).not.toContain('provider unavailable');
  expect(serializedTrace).not.toContain('partial');
});

it('retains a completed Session turn when final OutputSink close fails', async () => {
  const session = new MemorySessionAdapter();
  const journal = new MemoryRequestJournalAdapter(() => 1);
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
  const sink = new FailingCloseOutputSink();
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => 'close-failure-run',
    session,
    requestJournal: journal,
    observability: { sink: trace, clock: () => 1 },
    provider: { responses: [{ status: 'success', text: 'persisted' }] },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });

  await expect(
    agent.run({
      sessionId: sessionId,
      idempotencyKey: 'close-failure-request',
      message: 'start',
      outputSink: sink,
    })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_OUTPUT_FAILED' })
  );
  const snapshot = await session.inspect({
    agentId: agent.identity.id,
    sessionId: parseSessionId(sessionId),
  });
  expect(snapshot?.turns[0]).toMatchObject({
    status: 'completed',
    assistantMessage: { text: 'persisted' },
  });
  expect(sink.inspect()).toMatchObject({
    status: 'failed',
    failure: { code: 'REQUEST_OUTPUT_FAILED' },
  });
  expect(
    await journal.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId(sessionId),
      idempotencyKey: parseRequestIdempotencyKey('close-failure-request'),
    })
  ).toMatchObject({ status: 'completed', response: { message: { text: 'persisted' } } });
  expect(
    trace
      .inspect({ agentRunId: 'close-failure-run' })
      .events.find((event) => event.type === 'output-publication-failed')
  ).toMatchObject({ stage: 'close', errorCode: 'REQUEST_OUTPUT_FAILED' });
});

it('normalizes OutputSink write failure and fails the active Session turn', async () => {
  const session = new MemorySessionAdapter();
  const sink = new FailingWriteOutputSink();
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    session,
    provider: { responses: [{ status: 'success', text: 'not published' }] },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });

  await expect(
    agent.run({ sessionId: sessionId, message: 'start', outputSink: sink })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_OUTPUT_FAILED' })
  );
  const snapshot = await session.inspect({
    agentId: agent.identity.id,
    sessionId: parseSessionId(sessionId),
  });
  expect(snapshot?.turns[0]).toMatchObject({
    status: 'failed',
    failureCode: 'REQUEST_OUTPUT_FAILED',
  });
  expect(sink.inspect()).toMatchObject({
    status: 'failed',
    failure: { code: 'REQUEST_OUTPUT_FAILED' },
  });
});

it('preserves provider and OutputSink cleanup failures in deterministic order', async () => {
  const sink = new FailingFailureOutputSink();
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    provider: { responses: [{ status: 'failure', message: 'provider failed' }] },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });

  let received: unknown;
  try {
    await agent.run({ sessionId: sessionId, message: 'start', outputSink: sink });
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toBeInstanceOf(AggregateError);
  const aggregate = received as AggregateError;
  expect(aggregate.errors[0]).toEqual(
    expect.objectContaining<Partial<ModelInvocationError>>({ code: 'MODEL_PROVIDER_FAILED' })
  );
  expect(aggregate.errors[1]).toEqual(expect.objectContaining({ message: 'fail failed' }));
});
