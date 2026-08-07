import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopRuntime,
} from '@ta-agent/base-model';
import {
  AgentRequestError,
  createRequestFingerprint,
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  parseRequestIdempotencyKey,
  RequestReplayFailedError,
  SqliteRequestJournalAdapter,
} from '@ta-agent/base-request';
import { MemorySessionAdapter, parseSessionId, SqliteSessionAdapter } from '@ta-agent/base-session';
import {
  AgentToolError,
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
  type ToolExecutionRequest,
} from '@ta-agent/base-tool';
import { describe, expect, it, vi } from 'vitest';
import { assembleAgentBase, createPiFauxAgentBase } from '../../src/index.js';
import {
  CancellingOutputSink,
  FailingCloseOutputSink,
  FailingFailureOutputSink,
  FailingWriteOutputSink,
  LifecycleRecordingOutputSink,
} from '../support/output-sinks.js';

describe('assembled Agent Base request path', () => {
  it('runs a bounded Pi tool loop and publishes only the final response', async () => {
    type AddInput = Readonly<{ left: number; right: number }>;
    const handler = vi.fn(({ arguments: input }: ToolExecutionRequest<AddInput>) =>
      Promise.resolve({ text: String(input.left + input.right) })
    );
    const add = defineTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: {
        type: 'object',
        properties: { left: { type: 'number' }, right: { type: 'number' } },
        required: ['left', 'right'],
        additionalProperties: false,
      },
      execute: handler,
    });
    const toolPermissionPolicy = defineToolPermissionPolicy({
      task: ['add'],
      assignment: ['add'],
      product: ['add'],
      runtime: ['add'],
    });
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      toolRegistry: createToolRegistry([add]),
      toolPermissionPolicy,
      pi: {
        responses: [
          {
            status: 'tool-call',
            callId: 'add-1',
            name: 'add',
            arguments: { left: 2, right: 3 },
            text: 'intermediate provider text',
          },
          (request) => ({
            status: 'success',
            text: `final:${request.toolResults.at(-1)?.text ?? 'missing'}`,
          }),
        ],
        charactersPerChunk: 2,
      },
    });
    const sink = new LifecycleRecordingOutputSink();

    const response = await agent.run({ message: 'add two and three', outputSink: sink });

    expect(response.message.text).toBe('final:5');
    expect(
      sink
        .inspect()
        .events.map((event) => event.delta)
        .join('')
    ).toBe('final:5');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.toolRun).toMatchObject({
      status: 'closed',
      records: [{ callId: 'add-1', toolName: 'add', status: 'success' }],
      totalResultCharacters: 1,
    });
    expect(JSON.stringify(response.toolRun)).not.toContain('final:5');
    expect(agent.inspectPi().requests[1]?.toolResults).toEqual([
      { callId: 'add-1', toolName: 'add', text: '5', isError: false },
    ]);
  });

  it('denies a registered tool unless every permission layer explicitly allows it', async () => {
    const handler = vi.fn(() => Promise.resolve({ text: 'should not run' }));
    const tool = defineTool({
      name: 'private-tool',
      description: 'A tool that remains denied by default.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: handler,
    });
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      toolRegistry: createToolRegistry([tool]),
      pi: {
        responses: [{ status: 'tool-call', callId: 'denied', name: 'private-tool' }],
      },
    });
    const sink = new LifecycleRecordingOutputSink();

    await expect(agent.run({ message: 'try the tool', outputSink: sink })).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_NOT_AUTHORIZED' })
    );
    expect(handler).not.toHaveBeenCalled();
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'TOOL_NOT_AUTHORIZED' },
    });
  });

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

  it('restarts with a new assembled Agent and continues durable Session history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ta-agent-assembled-session-'));
    const databasePath = join(directory, 'session.sqlite');
    try {
      const firstSession = new SqliteSessionAdapter({ databasePath });
      const firstAgent = createPiFauxAgentBase({
        identity: { id: 'durable-assistant' },
        session: firstSession,
        pi: { responses: [{ status: 'success', text: 'Remembered.' }] },
      });
      const first = await firstAgent.run({
        sessionId: 'durable-conversation',
        message: 'Remember this.',
      });

      const reopenedSession = new SqliteSessionAdapter({ databasePath });
      const reopenedAgent = createPiFauxAgentBase({
        identity: { id: 'durable-assistant' },
        session: reopenedSession,
        pi: {
          responses: [
            (request) => ({
              status: 'success',
              text: `history:${request.messages.map((message) => message.role).join(',')}`,
            }),
          ],
        },
      });
      const second = await reopenedAgent.run({
        sessionId: first.sessionId,
        message: 'What did I ask?',
      });

      expect(second.message.text).toBe('history:user,assistant,user');
      const snapshot = await reopenedSession.inspect({
        agentId: reopenedAgent.identity.id,
        sessionId: parseSessionId('durable-conversation'),
      });
      expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
      const independentlyReopened = new SqliteSessionAdapter({ databasePath });
      expect(
        (
          await independentlyReopened.inspect({
            agentId: reopenedAgent.identity.id,
            sessionId: parseSessionId('durable-conversation'),
          })
        )?.turns.map((turn) => turn.status)
      ).toEqual(['completed', 'completed']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('replays a durable request after restart without repeating Pi, tools, or Session turns', async () => {
    type AddInput = Readonly<{ left: number; right: number }>;
    const directory = mkdtempSync(join(tmpdir(), 'ta-agent-durable-replay-'));
    const databasePath = join(directory, 'agent.sqlite');
    const handler = vi.fn(({ arguments: input }: ToolExecutionRequest<AddInput>) =>
      Promise.resolve({ text: `PRIVATE_TOOL_RESULT_${input.left + input.right}` })
    );
    const add = defineTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: {
        type: 'object',
        properties: { left: { type: 'number' }, right: { type: 'number' } },
        required: ['left', 'right'],
        additionalProperties: false,
      },
      execute: handler,
    });
    const toolPermissionPolicy = defineToolPermissionPolicy({
      task: ['add'],
      assignment: ['add'],
      product: ['add'],
      runtime: ['add'],
    });
    try {
      const firstSession = new SqliteSessionAdapter({ databasePath });
      const firstJournal = new SqliteRequestJournalAdapter({ databasePath });
      const firstAgent = createPiFauxAgentBase({
        identity: { id: 'replay-assistant' },
        session: firstSession,
        requestJournal: firstJournal,
        toolRegistry: createToolRegistry([add]),
        toolPermissionPolicy,
        createRunId: () => 'original-request',
        pi: {
          responses: [
            { status: 'tool-call', callId: 'add-1', name: 'add', arguments: { left: 2, right: 3 } },
            { status: 'success', text: 'done' },
          ],
        },
      });
      const first = await firstAgent.run({
        sessionId: 'replay-conversation',
        idempotencyKey: 'logical-request-1',
        message: 'add two and three',
      });

      const reopenedSession = new SqliteSessionAdapter({ databasePath });
      const reopenedJournal = new SqliteRequestJournalAdapter({ databasePath });
      const reopenedAgent = createPiFauxAgentBase({
        identity: { id: 'replay-assistant' },
        session: reopenedSession,
        requestJournal: reopenedJournal,
        toolRegistry: createToolRegistry([add]),
        toolPermissionPolicy,
        createRunId: () => 'retry-request',
        pi: { responses: [{ status: 'success', text: 'must not execute' }] },
      });
      const replaySink = new LifecycleRecordingOutputSink();
      const replayed = await reopenedAgent.run({
        sessionId: 'replay-conversation',
        idempotencyKey: 'logical-request-1',
        message: 'add two and three',
        outputSink: replaySink,
      });

      expect(replayed).toEqual(first);
      expect(reopenedAgent.inspectPi().callCount).toBe(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(replaySink.calls).toEqual(['open', 'write', 'close']);
      expect(replaySink.inspect().events).toEqual([{ type: 'text-delta', delta: 'done' }]);
      expect(
        (
          await reopenedSession.inspect({
            agentId: reopenedAgent.identity.id,
            sessionId: parseSessionId('replay-conversation'),
          })
        )?.turns
      ).toHaveLength(1);
      const journalEntry = await reopenedJournal.inspect({
        agentId: reopenedAgent.identity.id,
        sessionId: parseSessionId('replay-conversation'),
        idempotencyKey: parseRequestIdempotencyKey('logical-request-1'),
      });
      expect(journalEntry).toMatchObject({ status: 'completed', requestId: 'original-request' });
      expect(JSON.stringify(journalEntry)).not.toContain('add two and three');
      expect(JSON.stringify(journalEntry)).not.toContain('PRIVATE_TOOL_RESULT_5');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails existing active, failed, and conflicting replay authorities without execution', async () => {
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const session = new MemorySessionAdapter();
    const agent = createPiFauxAgentBase({
      identity: { id: 'replay-guard' },
      session,
      requestJournal: journal,
      createRunId: () => 'retry-request',
      pi: { responses: [{ status: 'success', text: 'must not execute' }] },
    });
    const agentId = agent.identity.id;
    const sessionId = parseSessionId('replay-guards');
    const activeKey = parseRequestIdempotencyKey('active-key');
    const failedKey = parseRequestIdempotencyKey('failed-key');
    const conflictKey = parseRequestIdempotencyKey('conflict-key');
    await journal.claim({
      agentId,
      sessionId,
      idempotencyKey: activeKey,
      fingerprint: createRequestFingerprint({ message: 'active' }),
      requestId: 'active-owner',
    });
    await journal.claim({
      agentId,
      sessionId,
      idempotencyKey: failedKey,
      fingerprint: createRequestFingerprint({ message: 'failed' }),
      requestId: 'failed-owner',
    });
    await journal.fail({
      agentId,
      sessionId,
      idempotencyKey: failedKey,
      requestId: 'failed-owner',
      failure: { code: 'MODEL_FAILED', message: 'original failure' },
    });
    await journal.claim({
      agentId,
      sessionId,
      idempotencyKey: conflictKey,
      fingerprint: createRequestFingerprint({ message: 'original' }),
      requestId: 'conflict-owner',
    });

    await expect(
      agent.run({ sessionId, idempotencyKey: activeKey, message: 'active' })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_REPLAY_IN_PROGRESS' })
    );
    await expect(
      agent.run({ sessionId, idempotencyKey: failedKey, message: 'failed' })
    ).rejects.toEqual(
      expect.objectContaining<Partial<RequestReplayFailedError>>({
        code: 'REQUEST_REPLAY_FAILED',
        originalFailure: { code: 'MODEL_FAILED', message: 'original failure' },
      })
    );
    await expect(
      agent.run({ sessionId, idempotencyKey: conflictKey, message: 'different' })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_REPLAY_CONFLICT' })
    );
    expect(agent.inspectPi().callCount).toBe(0);
    expect((await session.inspect({ agentId, sessionId }))?.turns).toHaveLength(0);
    expect(await journal.inspect({ agentId, sessionId, idempotencyKey: activeKey })).toMatchObject({
      status: 'active',
      requestId: 'active-owner',
    });
  });

  it('propagates cancellation and fails the active Session turn and OutputSink', async () => {
    const session = new MemorySessionAdapter();
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const controller = new AbortController();
    const sink = new CancellingOutputSink(controller);
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      session,
      requestJournal: journal,
      pi: {
        responses: [{ status: 'success', text: 'abcdefghij' }],
        charactersPerChunk: 1,
        tokensPerSecond: 1_000,
      },
    });

    await expect(
      agent.run(
        {
          sessionId: 'cancelled',
          idempotencyKey: 'cancelled-request',
          message: 'start',
          outputSink: sink,
        },
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
    expect(
      await journal.inspect({
        agentId: agent.identity.id,
        sessionId: parseSessionId('cancelled'),
        idempotencyKey: parseRequestIdempotencyKey('cancelled-request'),
      })
    ).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_INVOCATION_CANCELLED' },
    });
  });

  it('preserves partial output while reporting provider failure', async () => {
    const sink = new LifecycleRecordingOutputSink();
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      requestJournal: journal,
      pi: {
        responses: [{ status: 'failure', message: 'provider unavailable', partialText: 'partial' }],
        charactersPerChunk: 3,
      },
    });

    await expect(
      agent.run({
        sessionId: 'failure',
        idempotencyKey: 'failure-request',
        message: 'start',
        outputSink: sink,
      })
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
    expect(
      await journal.inspect({
        agentId: agent.identity.id,
        sessionId: parseSessionId('failure'),
        idempotencyKey: parseRequestIdempotencyKey('failure-request'),
      })
    ).toMatchObject({ status: 'failed', failure: { code: 'MODEL_PROVIDER_FAILED' } });
  });

  it('retains a completed Session turn when final OutputSink close fails', async () => {
    const session = new MemorySessionAdapter();
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const sink = new FailingCloseOutputSink();
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      session,
      requestJournal: journal,
      pi: { responses: [{ status: 'success', text: 'persisted' }] },
    });

    await expect(
      agent.run({
        sessionId: 'close-failure',
        idempotencyKey: 'close-failure-request',
        message: 'start',
        outputSink: sink,
      })
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
    expect(
      await journal.inspect({
        agentId: agent.identity.id,
        sessionId: parseSessionId('close-failure'),
        idempotencyKey: parseRequestIdempotencyKey('close-failure-request'),
      })
    ).toMatchObject({ status: 'completed', response: { message: { text: 'persisted' } } });
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
    await expect(
      agent.run({ message: 'hello', idempotencyKey: 'missing-session' })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_INPUT_INVALID' })
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
        maxProviderTurns: 4,
        timeoutMilliseconds: 5,
      },
    });

    await expect(agent.run({ message: 'wait' })).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_TIMEOUT' })
    );
  });
});
