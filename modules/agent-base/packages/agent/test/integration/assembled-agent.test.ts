import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopRuntime,
} from '@ta-agent/base-model';
import { AgentRequestError, MemoryOutputSink } from '@ta-agent/base-request';
import { MemorySessionAdapter, parseSessionId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import { assembleAgentBase, createPiFauxAgentBase } from '../../src/index.js';
import {
  CancellingOutputSink,
  FailingCloseOutputSink,
  FailingFailureOutputSink,
  FailingWriteOutputSink,
  LifecycleRecordingOutputSink,
} from '../support/output-sinks.js';

describe('assembled Agent Base request path', () => {
  it('streams one response and supplies completed history to a second Pi request', async () => {
    const session = new MemorySessionAdapter();
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant', displayName: 'Assistant' },
      session,
      pi: {
        responses: [
          { status: 'success', text: 'Hello Wei.' },
          (request) => ({
            status: 'success',
            text: `history:${request.messages.map((message) => message.role).join(',')}`,
          }),
        ],
        charactersPerChunk: 3,
      },
      clock: (() => {
        let now = 0;
        return () => ++now;
      })(),
    });
    const firstSink = new LifecycleRecordingOutputSink();
    const first = await agent.run({
      sessionId: 'conversation',
      message: 'My name is Wei.',
      outputSink: firstSink,
    });
    const secondSink = new MemoryOutputSink();
    const second = await agent.run({
      sessionId: first.sessionId,
      message: 'What is my name?',
      outputSink: secondSink,
    });

    expect(first.message.text).toBe('Hello Wei.');
    expect(
      firstSink
        .inspect()
        .events.map((event) => event.delta)
        .join('')
    ).toBe('Hello Wei.');
    expect(firstSink.calls.at(0)).toBe('open');
    expect(firstSink.calls.at(-1)).toBe('close');
    expect(second.message.text).toBe('history:user,assistant,user');
    expect(agent.inspectPi().requests[1]?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    const snapshot = await session.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId('conversation'),
    });
    expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
  });

  it('propagates cancellation and fails the active Session turn and OutputSink', async () => {
    const session = new MemorySessionAdapter();
    const controller = new AbortController();
    const sink = new CancellingOutputSink(controller);
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      session,
      pi: {
        responses: [{ status: 'success', text: 'abcdefghij' }],
        charactersPerChunk: 1,
        tokensPerSecond: 1_000,
      },
    });

    await expect(
      agent.run(
        { sessionId: 'cancelled', message: 'start', outputSink: sink },
        { signal: controller.signal }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_INVOCATION_CANCELLED',
      })
    );
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_INVOCATION_CANCELLED' },
    });
    const snapshot = await session.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId('cancelled'),
    });
    expect(snapshot?.turns[0]).toMatchObject({
      status: 'failed',
      failureCode: 'MODEL_INVOCATION_CANCELLED',
    });
  });

  it('preserves partial output while reporting provider failure', async () => {
    const sink = new LifecycleRecordingOutputSink();
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      pi: {
        responses: [{ status: 'failure', message: 'provider unavailable', partialText: 'partial' }],
        charactersPerChunk: 3,
      },
    });

    await expect(
      agent.run({ sessionId: 'failure', message: 'start', outputSink: sink })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(sink.inspect()).toMatchObject({ status: 'failed' });
    expect(
      sink
        .inspect()
        .events.map((event) => event.delta)
        .join('')
    ).toBe('partial');
    expect(sink.calls.at(-1)).toBe('fail');
  });

  it('retains a completed Session turn when final OutputSink close fails', async () => {
    const session = new MemorySessionAdapter();
    const sink = new FailingCloseOutputSink();
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      session,
      pi: { responses: [{ status: 'success', text: 'persisted' }] },
    });

    await expect(
      agent.run({ sessionId: 'close-failure', message: 'start', outputSink: sink })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_OUTPUT_FAILED' })
    );
    const snapshot = await session.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId('close-failure'),
    });
    expect(snapshot?.turns[0]).toMatchObject({
      status: 'completed',
      assistantMessage: { text: 'persisted' },
    });
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'REQUEST_OUTPUT_FAILED' },
    });
  });

  it('normalizes OutputSink write failure and fails the active Session turn', async () => {
    const session = new MemorySessionAdapter();
    const sink = new FailingWriteOutputSink();
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      session,
      pi: { responses: [{ status: 'success', text: 'not published' }] },
    });

    await expect(
      agent.run({ sessionId: 'write-failure', message: 'start', outputSink: sink })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_OUTPUT_FAILED' })
    );
    const snapshot = await session.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId('write-failure'),
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
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      pi: { responses: [{ status: 'failure', message: 'provider failed' }] },
    });

    let received: unknown;
    try {
      await agent.run({ sessionId: 'aggregate', message: 'start', outputSink: sink });
    } catch (error: unknown) {
      received = error;
    }
    expect(received).toBeInstanceOf(AggregateError);
    const aggregate = received as AggregateError;
    expect(aggregate.errors[0]).toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(aggregate.errors[1]).toEqual(expect.objectContaining({ message: 'fail failed' }));
  });

  it('propagates an individual Step override through the unchanged request composition', async () => {
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      pi: {
        responses: [(request) => ({ status: 'success', text: request.instructions })],
      },
      stepOverrides: {
        resolveInstructions: (context) => {
          context.instructions = 'Overridden instructions.';
          return Promise.resolve();
        },
      },
    });

    const response = await agent.run({ message: 'hello' });
    expect(response.message.text).toBe('Overridden instructions.');
    expect(agent.inspectPi().requests[0]?.instructions).toBe('Overridden instructions.');
  });

  it('fails invalid request input before invoking Pi', async () => {
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      pi: { responses: [{ status: 'success', text: 'unused' }] },
    });

    await expect(agent.run({ message: '   ' })).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_INPUT_INVALID' })
    );
    await expect(agent.run({ message: 'hello', sessionId: 'invalid session' })).rejects.toEqual(
      expect.objectContaining({ code: 'SESSION_ID_INVALID' })
    );
    expect(agent.inspectPi().callCount).toBe(0);
  });

  it('applies the assembled request timeout and reports it distinctly', async () => {
    const modelReference = defineProviderModelReference({ provider: 'waiting', model: 'model' });
    const runtime: AgentLoopRuntime = {
      resolveTarget: (reference) =>
        Promise.resolve(
          Object.freeze({
            reference,
            capabilities: Object.freeze({ streaming: true, tools: false }),
          })
        ),
      run: (request) =>
        new Promise((_resolve, reject) => {
          const rejectForAbort = () => {
            const timedOut =
              request.signal.reason instanceof DOMException &&
              request.signal.reason.name === 'TimeoutError';
            reject(
              new AgentModelError(
                timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
                timedOut ? 'timed out' : 'cancelled'
              )
            );
          };
          if (request.signal.aborted) rejectForAbort();
          else request.signal.addEventListener('abort', rejectForAbort, { once: true });
        }),
    };
    const agent = assembleAgentBase({
      identity: { id: 'assistant' },
      modelRuntime: runtime,
      modelReference,
      requestPolicy: {
        maxMessageCharacters: 100,
        maxInstructionsCharacters: 100,
        maxOutputCharacters: 100,
        timeoutMilliseconds: 5,
      },
    });

    await expect(agent.run({ message: 'wait' })).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_TIMEOUT' })
    );
  });
});
