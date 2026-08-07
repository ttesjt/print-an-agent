import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopRuntime,
} from '@ta-agent/base-model';
import { MemoryAgentTraceAdapter } from '@ta-agent/base-observability';
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
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
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
      createRunId: () => 'trace-request',
      createWorkflowRunId: () => 'trace-workflow',
      instructionContributors: [() => 'PRIVATE_INSTRUCTION_TEXT'],
      observability: { sink: trace, clock: () => 1 },
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

    const response = await agent.run({
      message: 'PRIVATE_REQUEST_add two and three',
      outputSink: sink,
    });

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
    const events = trace.inspect({ agentRunId: 'trace-request' }).events;
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_value, index) => index + 1)
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent-run-started',
        'workflow-run-started',
        'session-resolved',
        'execution-target-resolved',
        'tools-resolved',
        'agent-loop-started',
        'provider-turn-started',
        'provider-turn-completed',
        'tool-call-started',
        'tool-call-completed',
        'model-response-completed',
        'agent-loop-completed',
        'output-publication-completed',
        'workflow-run-completed',
        'agent-run-completed',
      ])
    );
    expect(events.filter((event) => event.type === 'provider-turn-started')).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('agent-run-completed');
    const serializedTrace = JSON.stringify(events);
    for (const secret of [
      'PRIVATE_REQUEST',
      'PRIVATE_INSTRUCTION_TEXT',
      'intermediate provider text',
      'final:5',
      '"left":2',
    ]) {
      expect(serializedTrace).not.toContain(secret);
    }
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
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    const runIds = ['history-first-run', 'history-second-run'];
    let runIndex = 0;
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant', displayName: 'Assistant' },
      createRunId: () => runIds[runIndex++] ?? 'unexpected-history-run',
      session,
      observability: { sink: trace, clock: () => 1 },
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
    const serializedSecondTrace = JSON.stringify(
      trace.inspect({ agentRunId: 'history-second-run' }).events
    );
    for (const privateText of [
      'My name is Wei.',
      'Hello Wei.',
      'What is my name?',
      'history:user,assistant,user',
    ]) {
      expect(serializedSecondTrace).not.toContain(privateText);
    }
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
      const firstTrace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
      const firstAgent = createPiFauxAgentBase({
        identity: { id: 'replay-assistant' },
        session: firstSession,
        requestJournal: firstJournal,
        toolRegistry: createToolRegistry([add]),
        toolPermissionPolicy,
        createRunId: () => 'original-request',
        observability: { sink: firstTrace, clock: () => 1 },
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
      expect(JSON.stringify(firstTrace.inspect().events)).not.toContain('PRIVATE_TOOL_RESULT_5');

      const reopenedSession = new SqliteSessionAdapter({ databasePath });
      const reopenedJournal = new SqliteRequestJournalAdapter({ databasePath });
      const replayTrace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
      const reopenedAgent = createPiFauxAgentBase({
        identity: { id: 'replay-assistant' },
        session: reopenedSession,
        requestJournal: reopenedJournal,
        toolRegistry: createToolRegistry([add]),
        toolPermissionPolicy,
        createRunId: () => 'retry-request',
        createWorkflowRunId: () => 'retry-workflow',
        observability: { sink: replayTrace, clock: () => 1 },
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
      const replayEvents = replayTrace.inspect({ agentRunId: 'retry-request' }).events;
      const replayEventTypes = replayEvents.map((event) => event.type);
      expect(replayEventTypes).toContain('request-replay-resolved');
      expect(replayEvents.find((event) => event.type === 'request-replay-resolved')).toMatchObject({
        status: 'completed',
      });
      expect(replayEventTypes).toContain('output-publication-completed');
      expect(replayEventTypes).not.toContain('agent-loop-started');
      expect(replayEventTypes).not.toContain('provider-turn-started');
      expect(replayEventTypes).not.toContain('tool-call-started');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails existing active, failed, and conflicting replay authorities without execution', async () => {
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const session = new MemorySessionAdapter();
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    const runIds = ['active-retry', 'failed-retry', 'conflict-retry'];
    let runIndex = 0;
    const agent = createPiFauxAgentBase({
      identity: { id: 'replay-guard' },
      session,
      requestJournal: journal,
      createRunId: () => runIds[runIndex++] ?? 'unexpected-retry',
      observability: { sink: trace, clock: () => 1 },
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
    expect(
      runIds.map((agentRunId) =>
        trace
          .inspect({ agentRunId })
          .events.find((event) => event.type === 'request-replay-resolved')
      )
    ).toMatchObject([{ status: 'active' }, { status: 'failed' }, { status: 'conflict' }]);
  });

  it('propagates cancellation and fails the active Session turn and OutputSink', async () => {
    const session = new MemorySessionAdapter();
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const controller = new AbortController();
    const sink = new CancellingOutputSink(controller);
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      createRunId: () => 'cancelled-run',
      session,
      requestJournal: journal,
      observability: { sink: trace, clock: () => 1 },
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
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      createRunId: () => 'provider-failure-run',
      requestJournal: journal,
      observability: { sink: trace, clock: () => 1 },
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
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      createRunId: () => 'close-failure-run',
      session,
      requestJournal: journal,
      observability: { sink: trace, clock: () => 1 },
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
    expect(
      trace
        .inspect({ agentRunId: 'close-failure-run' })
        .events.find((event) => event.type === 'output-publication-failed')
    ).toMatchObject({ stage: 'close', errorCode: 'REQUEST_OUTPUT_FAILED' });
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

  it('isolates a failed trace sink from the assembled request result', async () => {
    const observedFailures: string[] = [];
    const agent = createPiFauxAgentBase({
      identity: { id: 'assistant' },
      observability: {
        sink: { record: () => Promise.reject(new Error('trace unavailable')) },
        onSinkFailure: (failure) => {
          observedFailures.push(failure.event.type);
          return Promise.resolve();
        },
      },
      pi: { responses: [{ status: 'success', text: 'still succeeds' }] },
    });

    await expect(agent.run({ message: 'hello' })).resolves.toMatchObject({
      message: { text: 'still succeeds' },
    });
    expect(observedFailures.at(0)).toBe('agent-run-started');
    expect(observedFailures.at(-1)).toBe('agent-run-completed');
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
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const modelReference = defineProviderModelReference({
      provider: 'waiting',
      model: 'model',
      baseUrl: 'https://PRIVATE_ENDPOINT.example',
    });
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
      createRunId: () => 'timeout-run',
      modelRuntime: runtime,
      modelReference,
      observability: { sink: trace, clock: () => 1 },
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
    const serializedTrace = JSON.stringify(trace.inspect({ agentRunId: 'timeout-run' }).events);
    expect(serializedTrace).toContain('MODEL_INVOCATION_TIMEOUT');
    expect(serializedTrace).not.toContain('PRIVATE_ENDPOINT');
    expect(serializedTrace).not.toContain('timed out');
  });
});
