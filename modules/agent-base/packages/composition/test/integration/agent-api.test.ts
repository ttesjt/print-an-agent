import { TEST_COMPACTION_TOKEN_COUNTER } from '../support/compaction-token-counter.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  MAIN_ACTOR_ID,
  SESSION_COMPACTION_RESPONSIBILITY_ID,
  type ResponsibilityDefinitionInput,
} from '@ta-agent/base-actor';
import {
  ModelInvocationError,
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  type AssistantModelMessage,
} from '@ta-agent/model-invocation-core';
import {
  MemoryAgentTraceAdapter,
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
  SqliteRequestJournalAdapter,
  SqliteSessionAdapter,
} from '@ta-agent/base-local-adapters';
import {
  AgentRequestError,
  createRequestFingerprint,
  parseRequestIdempotencyKey,
  REQUEST_WORKFLOW_NAME,
  RequestReplayFailedError,
} from '@ta-agent/base-request';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  executeSessionNavigation,
  parseSessionBranchId,
  parseSessionId,
  SESSION_COMPACTION_WORKFLOW_NAME,
} from '@ta-agent/base-session';
import {
  AgentToolError,
  createToolRegistry,
  defineTool,
  type ToolExecutionRequest,
} from '@ta-agent/base-tool';
import { describe, expect, it, vi } from 'vitest';
import {
  composeAgent,
  createDeterministicAgentAPI,
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from '../../src/index.js';
import {
  CancellingOutputSink,
  FailingCloseOutputSink,
  FailingFailureOutputSink,
  FailingWriteOutputSink,
  LifecycleRecordingOutputSink,
} from '../support/output-sinks.js';

function responsibilitiesAllowingTools(
  allowedTools: readonly string[]
): readonly ResponsibilityDefinitionInput[] {
  return BUILT_IN_RESPONSIBILITIES.map((definition) =>
    definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID
      ? { ...definition, allowedTools }
      : definition
  );
}

function customAssistantMessage(text: string): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.custom-target',
      evidence: { artifactId: 'PRIVATE_ARTIFACT_ID' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 1,
  });
}

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
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      createRunId: () => 'trace-request',
      createWorkflowRunId: () => 'trace-workflow',
      instructionContributors: [() => 'PRIVATE_INSTRUCTION_TEXT'],
      observability: { sink: trace, clock: () => 1 },
      toolRegistry: createToolRegistry([add]),
      mainActor: {
        invocationConfig: { temperature: 0.2, maxOutputTokens: 500 },
        allowedTools: ['add'],
      },
      responsibilities: responsibilitiesAllowingTools(['add']),
      productToolAllowList: ['add'],
      runtimeToolAllowList: ['add'],
      provider: {
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

    expect(agent.agent.identity).toBe(agent.identity);
    expect(agent).not.toHaveProperty('navigateSession');
    expect(agent.agent.operationNames).toBe(agent.operationNames);
    expect(agent.agent.workflowCatalog.names).toBe(agent.workflowNames);
    expect(agent.operationNames).toEqual([
      FOREGROUND_AGENT_OPERATION_NAME,
      SESSION_COMPACTION_AGENT_OPERATION_NAME,
    ]);
    expect(agent.workflowNames).toEqual([REQUEST_WORKFLOW_NAME, SESSION_COMPACTION_WORKFLOW_NAME]);

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
    expect(agent.inspectDeterministicProvider().requests[1]?.toolResults).toEqual([
      { callId: 'add-1', toolName: 'add', text: '5', isError: false },
    ]);
    expect(agent.inspectDeterministicProvider().requests[0]?.invocationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 500,
    });
    const events = trace.inspect({ agentRunId: 'trace-request' }).events;
    expect(events.at(0)).toMatchObject({
      type: 'agent-run-started',
      operationName: FOREGROUND_AGENT_OPERATION_NAME,
    });
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_value, index) => index + 1)
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent-run-started',
        'workflow-run-started',
        'session-resolved',
        'actor-resolved',
        'tools-resolved',
        'agent-loop-started',
        'model-turn-started',
        'model-turn-completed',
        'tool-call-started',
        'tool-call-completed',
        'model-response-completed',
        'agent-loop-completed',
        'output-publication-completed',
        'workflow-run-completed',
        'agent-run-completed',
      ])
    );
    expect(events.every((event) => event.schemaVersion === 2)).toBe(true);
    expect(
      events
        .filter((event) => event.type === 'model-turn-started')
        .map((event) => event.modelTurnIndex)
    ).toEqual([1, 2]);
    expect(events.find((event) => event.type === 'agent-loop-started')).toMatchObject({
      maxModelTurns: 4,
    });
    expect(events.find((event) => event.type === 'actor-resolved')).toMatchObject({
      responsibilityId: FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
      responsibilityRevision: 1,
      actorId: MAIN_ACTOR_ID,
      actorRevision: 1,
      engineId: 'deterministic-provider',
      candidateIndex: 0,
      invocationMode: 'interaction',
    });
    expect(events.find((event) => event.type === 'model-response-completed')).toMatchObject({
      modelTurnIndex: 2,
      engineId: 'deterministic-provider',
      provenanceKind: 'provider-model',
      provider: 'faux',
      model: 'faux-model',
    });
    expect(events.find((event) => event.type === 'agent-loop-completed')).toMatchObject({
      modelTurns: 2,
    });
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
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      toolRegistry: createToolRegistry([tool]),
      provider: {
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

  it('fails an all-disabled foreground Responsibility before invoking an Engine', async () => {
    const session = new MemorySessionAdapter();
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'disabled-responsibility-agent' },
      session,
      createRunId: () => 'disabled-responsibility-run',
      responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) =>
        definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID
          ? {
              ...definition,
              actors: [{ actorId: MAIN_ACTOR_ID, enabled: false }],
            }
          : definition
      ),
      provider: { responses: [{ status: 'success', text: 'must not execute' }] },
    });
    const { sessionId } = await agent.agent.resources.session.resolve({
      agentId: agent.identity.id,
    });
    const sink = new LifecycleRecordingOutputSink();

    await expect(
      agent.run({ message: 'hello', sessionId: sessionId, outputSink: sink })
    ).rejects.toMatchObject({ code: 'RESPONSIBILITY_UNAVAILABLE' });
    expect(agent.inspectDeterministicProvider().callCount).toBe(0);
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'RESPONSIBILITY_UNAVAILABLE' },
    });
    expect(
      (
        await session.inspect({
          agentId: agent.identity.id,
          sessionId: parseSessionId(sessionId),
        })
      )?.turns
    ).toMatchObject([{ status: 'failed', failureCode: 'RESPONSIBILITY_UNAVAILABLE' }]);
  });

  it('streams one response and supplies completed history to a second Pi request', async () => {
    const session = new MemorySessionAdapter();
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    const runIds = ['history-first-run', 'history-second-run'];
    let runIndex = 0;
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant', displayName: 'Assistant' },
      createRunId: () => runIds[runIndex++] ?? 'unexpected-history-run',
      session,
      observability: { sink: trace, clock: () => 1 },
      provider: {
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
    const { sessionId } = await agent.agent.resources.session.resolve({
      agentId: agent.identity.id,
    });
    const firstSink = new LifecycleRecordingOutputSink();
    const first = await agent.run({
      sessionId: sessionId,
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
    expect(
      agent.inspectDeterministicProvider().requests[1]?.messages.map((message) => message.role)
    ).toEqual(['user', 'assistant', 'user']);
    const snapshot = await session.inspect({
      agentId: agent.identity.id,
      sessionId: parseSessionId(sessionId),
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
      const firstAgent = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'durable-assistant' },
        session: firstSession,
        provider: { responses: [{ status: 'success', text: 'Remembered.' }] },
      });
      const { sessionId } = await firstAgent.agent.resources.session.resolve({
        agentId: firstAgent.identity.id,
      });
      const first = await firstAgent.run({
        sessionId: sessionId,
        message: 'Remember this.',
      });

      const reopenedSession = new SqliteSessionAdapter({ databasePath });
      const reopenedAgent = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'durable-assistant' },
        session: reopenedSession,
        provider: {
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
        sessionId: parseSessionId(sessionId),
      });
      expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
      const independentlyReopened = new SqliteSessionAdapter({ databasePath });
      expect(
        (
          await independentlyReopened.inspect({
            agentId: reopenedAgent.identity.id,
            sessionId: parseSessionId(sessionId),
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
    try {
      const firstSession = new SqliteSessionAdapter({ databasePath });
      const firstJournal = new SqliteRequestJournalAdapter({ databasePath });
      const firstTrace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
      const firstAgent = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'replay-assistant' },
        session: firstSession,
        requestJournal: firstJournal,
        toolRegistry: createToolRegistry([add]),
        mainActor: { allowedTools: ['add'] },
        responsibilities: responsibilitiesAllowingTools(['add']),
        productToolAllowList: ['add'],
        runtimeToolAllowList: ['add'],
        createRunId: () => 'original-request',
        observability: { sink: firstTrace, clock: () => 1 },
        provider: {
          responses: [
            { status: 'tool-call', callId: 'add-1', name: 'add', arguments: { left: 2, right: 3 } },
            { status: 'success', text: 'done' },
          ],
        },
      });
      const { sessionId } = await firstAgent.agent.resources.session.resolve({
        agentId: firstAgent.identity.id,
      });
      const first = await firstAgent.run({
        sessionId: sessionId,
        idempotencyKey: 'logical-request-1',
        message: 'add two and three',
      });
      expect(JSON.stringify(firstTrace.inspect().events)).not.toContain('PRIVATE_TOOL_RESULT_5');

      const reopenedSession = new SqliteSessionAdapter({ databasePath });
      const reopenedJournal = new SqliteRequestJournalAdapter({ databasePath });
      const replayTrace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
      const reopenedAgent = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'replay-assistant' },
        session: reopenedSession,
        requestJournal: reopenedJournal,
        toolRegistry: createToolRegistry([add]),
        mainActor: { allowedTools: ['add'] },
        responsibilities: responsibilitiesAllowingTools(['add']),
        productToolAllowList: ['add'],
        runtimeToolAllowList: ['add'],
        createRunId: () => 'retry-request',
        createWorkflowRunId: () => 'retry-workflow',
        observability: { sink: replayTrace, clock: () => 1 },
        provider: { responses: [{ status: 'success', text: 'must not execute' }] },
      });
      const replaySink = new LifecycleRecordingOutputSink();
      const replayed = await reopenedAgent.run({
        sessionId: sessionId,
        idempotencyKey: 'logical-request-1',
        message: 'add two and three',
        outputSink: replaySink,
      });

      expect(replayed).toEqual(first);
      expect(reopenedAgent.inspectDeterministicProvider().callCount).toBe(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(replaySink.calls).toEqual(['open', 'write', 'close']);
      expect(replaySink.inspect().events).toEqual([{ type: 'text-delta', delta: 'done' }]);
      expect(
        (
          await reopenedSession.inspect({
            agentId: reopenedAgent.identity.id,
            sessionId: parseSessionId(sessionId),
          })
        )?.turns
      ).toHaveLength(1);
      const journalEntry = await reopenedJournal.inspect({
        agentId: reopenedAgent.identity.id,
        sessionId: parseSessionId(sessionId),
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
      expect(replayEventTypes).not.toContain('model-turn-started');
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
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'replay-guard' },
      session,
      requestJournal: journal,
      createRunId: () => runIds[runIndex++] ?? 'unexpected-retry',
      observability: { sink: trace, clock: () => 1 },
      provider: { responses: [{ status: 'success', text: 'must not execute' }] },
    });
    const agentId = agent.identity.id;
    const { sessionId } = await session.resolve({ agentId });
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
    expect(agent.inspectDeterministicProvider().callCount).toBe(0);
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

  it('isolates a failed trace sink from the assembled request result', async () => {
    const observedFailures: string[] = [];
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      observability: {
        sink: { record: () => Promise.reject(new Error('trace unavailable')) },
        onSinkFailure: (failure) => {
          observedFailures.push(failure.event.type);
          return Promise.resolve();
        },
      },
      provider: { responses: [{ status: 'success', text: 'still succeeds' }] },
    });

    await expect(agent.run({ message: 'hello' })).resolves.toMatchObject({
      message: { text: 'still succeeds' },
    });
    expect(observedFailures.at(0)).toBe('agent-run-started');
    expect(observedFailures.at(-1)).toBe('agent-run-completed');
  });

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
    await expect(
      agent.run({ message: 'hello', idempotencyKey: 'missing-session' })
    ).rejects.toEqual(
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

  it('compacts a durable Session through Pi and reuses projection plus tail after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ta-agent-compaction-'));
    const databasePath = join(directory, 'session.sqlite');
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    let requestSequence = 0;
    try {
      const first = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'assistant' },
        session: new SqliteSessionAdapter({ databasePath, clock: () => 10 }),
        createRunId: () => `request-${++requestSequence}`,
        createCompactionRunId: () => 'compaction-run',
        createCompactionWorkflowRunId: () => 'compaction-workflow',
        observability: { sink: trace, clock: () => 20 },
        provider: {
          responses: [
            { status: 'success', text: 'PRIVATE_ANSWER_1' },
            { status: 'success', text: 'PRIVATE_ANSWER_2' },
            { status: 'success', text: 'PRIVATE_ANSWER_3' },
            { status: 'success', text: 'PRIVATE_ANSWER_4' },
            { status: 'success', text: 'PRIVATE_COMPACTED_CONTEXT' },
          ],
        },
      });
      const { sessionId } = await first.agent.resources.session.resolve({
        agentId: first.identity.id,
      });
      for (let index = 1; index <= 4; index += 1) {
        await first.run({ message: `PRIVATE_USER_${index}`, sessionId: sessionId });
      }

      await expect(first.compactSession({ sessionId: sessionId })).resolves.toEqual({
        status: 'compacted',
        sessionId: sessionId,
        branchId: 'main',
        revision: 1,
        throughTurnId: 'request-2',
        compactedTurnCount: 2,
      });
      expect(first.inspectDeterministicProvider().requests.at(-1)).toMatchObject({
        kind: 'direct',
      });

      const reopenedSession = new SqliteSessionAdapter({ databasePath, clock: () => 30 });
      const reopened = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'assistant' },
        session: reopenedSession,
        createRunId: () => `request-${++requestSequence}`,
        provider: { responses: [{ status: 'success', text: 'PRIVATE_ANSWER_5' }] },
      });
      const requestAfterCompaction = {
        message: 'PRIVATE_USER_5',
        sessionId: sessionId,
        idempotencyKey: 'after-compaction',
      } as const;
      const firstAfterCompaction = await reopened.run(requestAfterCompaction);
      const replayAfterCompaction = await reopened.run(requestAfterCompaction);
      expect(replayAfterCompaction).toEqual(firstAfterCompaction);
      expect(reopened.inspectDeterministicProvider().callCount).toBe(1);

      const providerRequest = reopened.inspectDeterministicProvider().requests[0];
      expect(providerRequest).toMatchObject({ kind: 'agent-loop' });
      const serializedProviderRequest = JSON.stringify(providerRequest);
      expect(serializedProviderRequest).toContain('PRIVATE_COMPACTED_CONTEXT');
      expect(serializedProviderRequest).toContain('PRIVATE_USER_3');
      expect(serializedProviderRequest).toContain('PRIVATE_ANSWER_4');
      expect(serializedProviderRequest).not.toContain('PRIVATE_USER_1');
      expect(serializedProviderRequest).not.toContain('PRIVATE_ANSWER_2');
      expect(
        (
          await reopenedSession.inspect({
            agentId: reopened.identity.id,
            sessionId: parseSessionId(sessionId),
          })
        )?.turns
      ).toHaveLength(5);

      const compactionEvents = trace.inspect({ agentRunId: 'compaction-run' }).events;
      expect(
        compactionEvents.flatMap((event) => (event.type === 'step-started' ? [event.stepName] : []))
      ).toEqual([
        'runSessionCompaction',
        'inspectSession',
        'selectCompactionSource',
        'resolveCompactionTarget',
        'resolveCompactionTokenCounter',
        'resolveCompactionActor',
        'buildCompactedContext',
        'prepareCompactionAttempt',
        'generateCompactionCandidate',
        'measureCompactionCandidate',
        'validateCompactionCandidate',
        'persistCompaction',
      ]);
      const serializedTrace = JSON.stringify(compactionEvents);
      expect(serializedTrace).toContain('compactSession');
      expect(serializedTrace).not.toContain('PRIVATE_USER');
      expect(serializedTrace).not.toContain('PRIVATE_ANSWER');
      expect(serializedTrace).not.toContain('PRIVATE_COMPACTED_CONTEXT');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('skips compaction before policy eligibility without consuming a Pi response', async () => {
    let requestSequence = 0;
    const agent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      createRunId: () => `short-${++requestSequence}`,
      provider: {
        responses: [
          { status: 'success', text: 'one' },
          { status: 'success', text: 'two' },
          { status: 'success', text: 'reserved' },
        ],
      },
    });
    const { sessionId } = await agent.agent.resources.session.resolve({
      agentId: agent.identity.id,
    });
    await agent.run({ message: 'one', sessionId: sessionId });
    await agent.run({ message: 'two', sessionId: sessionId });

    await expect(agent.compactSession({ sessionId: sessionId })).resolves.toEqual({
      status: 'skipped',
      sessionId: sessionId,
      branchId: 'main',
      reason: 'not-needed',
    });
    expect(agent.inspectDeterministicProvider()).toMatchObject({
      callCount: 2,
      pendingResponseCount: 1,
    });
  });

  it('routes foreground interaction and compaction to different custom Engines', async () => {
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    let interactionCalls = 0;
    let directCalls = 0;
    const actorCatalog = createActorCatalog({
      actors: [
        { id: MAIN_ACTOR_ID, engineId: 'foreground-engine' },
        { id: 'compactor', engineId: 'compaction-engine' },
      ],
      engines: [
        {
          id: 'foreground-engine',
          capabilities: {
            invocationModes: ['interaction'],
            inputMediaTypes: ['text'],
            interaction: { streamable: true },
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          interact: async (request) => {
            interactionCalls += 1;
            const message = customAssistantMessage(`foreground-${interactionCalls}`);
            await request.emit({ type: 'interaction-start' });
            await request.emit({ type: 'turn-start' });
            await request.emit({ type: 'assistant-complete', message });
            await request.emit({ type: 'turn-end' });
            await request.emit({ type: 'interaction-end' });
            return Object.freeze({ message });
          },
        },
        {
          id: 'compaction-engine',
          capabilities: {
            invocationModes: ['direct'],
            inputMediaTypes: ['text'],
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          complete: () => {
            directCalls += 1;
            return Promise.resolve(
              Object.freeze({ message: customAssistantMessage('custom compacted context') })
            );
          },
        },
      ],
    });
    const responsibilityCatalog = createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) =>
        definition.id === SESSION_COMPACTION_RESPONSIBILITY_ID
          ? {
              ...definition,
              actors: [{ actorId: 'compactor', enabled: true }],
            }
          : definition
      ),
    });
    let requestSequence = 0;
    const agent = composeAgent({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'custom-engine-agent' },
      actorCatalog,
      responsibilityCatalog,
      createRunId: () => `custom-request-${++requestSequence}`,
      createCompactionRunId: () => 'custom-compaction',
      observability: { sink: trace, clock: () => 1 },
    });
    const { sessionId } = await agent.resources.session.resolve({ agentId: agent.identity.id });

    for (const message of ['one', 'two', 'three', 'four']) {
      await agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
        message,
        sessionId: sessionId,
      });
    }
    await expect(
      agent.invoke(SESSION_COMPACTION_AGENT_OPERATION_NAME, {
        sessionId: sessionId,
      })
    ).resolves.toMatchObject({ status: 'compacted', compactedTurnCount: 2 });

    expect(interactionCalls).toBe(4);
    expect(directCalls).toBe(1);
    expect(
      trace
        .inspect({ agentRunId: 'custom-compaction' })
        .events.find((event) => event.type === 'actor-resolved')
    ).toMatchObject({
      responsibilityId: SESSION_COMPACTION_RESPONSIBILITY_ID,
      actorId: 'compactor',
      engineId: 'compaction-engine',
      invocationMode: 'direct',
    });
    const modelResponse = trace
      .inspect()
      .events.find((event) => event.type === 'model-response-completed');
    expect(modelResponse).toMatchObject({
      engineId: 'foreground-engine',
      provenanceKind: 'engine-defined',
      provenanceType: 'test.custom-target',
    });
    expect(JSON.stringify(modelResponse)).not.toContain('PRIVATE_ARTIFACT_ID');
    expect(JSON.stringify(modelResponse)).not.toContain('foreground-1');
  });

  it('uses out-of-band navigation with branch-scoped runtime context and replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ta-agent-navigation-'));
    const sessionDatabasePath = join(directory, 'session.sqlite');
    const journalDatabasePath = join(directory, 'request-journal.sqlite');
    const childBranchId = parseSessionBranchId('child');
    let requestSequence = 0;
    try {
      const firstSession = new SqliteSessionAdapter({
        databasePath: sessionDatabasePath,
        clock: () => 10,
      });
      const first = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'navigation-assistant' },
        session: firstSession,
        requestJournal: new SqliteRequestJournalAdapter({
          databasePath: journalDatabasePath,
          clock: () => 11,
        }),
        createRunId: () => `branch-request-${++requestSequence}`,
        createCompactionRunId: () => 'branch-compaction',
        provider: {
          responses: [
            { status: 'success', text: 'PRIVATE_MAIN_ANSWER_1' },
            { status: 'success', text: 'PRIVATE_MAIN_ANSWER_2' },
            { status: 'success', text: 'PRIVATE_MAIN_ANSWER_3' },
            { status: 'success', text: 'PRIVATE_MAIN_ANSWER_4' },
            { status: 'success', text: 'PRIVATE_BRANCH_SUMMARY' },
            (request) => ({
              status: 'success',
              text: request.messages.map((message) => message.text).join('|'),
            }),
          ],
        },
      });
      const { sessionId } = await first.agent.resources.session.resolve({
        agentId: first.identity.id,
      });
      for (let index = 1; index <= 4; index += 1) {
        await first.run({
          message: `PRIVATE_MAIN_USER_${index}`,
          sessionId: sessionId,
        });
      }
      await first.compactSession({ sessionId: sessionId });
      const inspected = await executeSessionNavigation({
        agentId: first.identity.id,
        navigation: { sessionId: sessionId, operation: 'inspect' },
        session: firstSession,
      });
      expect(inspected).toMatchObject({
        status: 'inspected',
        navigation: { revision: 4, selectedBranchId: DEFAULT_SESSION_BRANCH_ID },
      });
      await expect(
        executeSessionNavigation({
          agentId: first.identity.id,
          navigation: {
            sessionId: sessionId,
            operation: 'rewind',
            throughTurnId: 'branch-request-2',
            newBranchId: childBranchId,
            expectedRevision: 4,
          },
          session: firstSession,
        })
      ).resolves.toEqual({
        status: 'rewound',
        sessionId: sessionId,
        selectedBranchId: childBranchId,
        affectedBranchId: childBranchId,
        revision: 5,
      });
      const childRequest = {
        message: 'PRIVATE_CHILD_USER',
        sessionId: sessionId,
        idempotencyKey: 'child-request',
      } as const;
      const childResponse = await first.run(childRequest);
      expect(childResponse.branchId).toBe(childBranchId);
      const childProviderRequest = first.inspectDeterministicProvider().requests.at(-1);
      const serializedChildRequest = JSON.stringify(childProviderRequest);
      expect(serializedChildRequest).toContain('PRIVATE_BRANCH_SUMMARY');
      expect(serializedChildRequest).toContain('PRIVATE_CHILD_USER');
      expect(serializedChildRequest).not.toContain('PRIVATE_MAIN_USER_3');
      expect(serializedChildRequest).not.toContain('PRIVATE_MAIN_ANSWER_4');

      await expect(
        executeSessionNavigation({
          agentId: first.identity.id,
          navigation: {
            sessionId: sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 6,
          },
          session: firstSession,
        })
      ).resolves.toMatchObject({
        status: 'selected',
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 7,
      });

      const reopenedSession = new SqliteSessionAdapter({
        databasePath: sessionDatabasePath,
        clock: () => 20,
      });
      const reopened = createDeterministicAgentAPI({
        sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
        identity: { id: 'navigation-assistant' },
        session: reopenedSession,
        requestJournal: new SqliteRequestJournalAdapter({
          databasePath: journalDatabasePath,
          clock: () => 21,
        }),
        createRunId: () => `branch-request-${++requestSequence}`,
        provider: {
          responses: [
            (request) => ({
              status: 'success',
              text: request.messages.map((message) => message.text).join('|'),
            }),
          ],
        },
      });
      const mainResponse = await reopened.run({
        message: 'PRIVATE_MAIN_USER_5',
        sessionId: sessionId,
      });
      expect(mainResponse.branchId).toBe(DEFAULT_SESSION_BRANCH_ID);
      const serializedMainRequest = JSON.stringify(
        reopened.inspectDeterministicProvider().requests[0]
      );
      expect(serializedMainRequest).toContain('PRIVATE_BRANCH_SUMMARY');
      expect(serializedMainRequest).toContain('PRIVATE_MAIN_USER_3');
      expect(serializedMainRequest).toContain('PRIVATE_MAIN_ANSWER_4');
      expect(serializedMainRequest).not.toContain('PRIVATE_CHILD_USER');

      await expect(reopened.run(childRequest)).resolves.toEqual(childResponse);
      expect(reopened.inspectDeterministicProvider().callCount).toBe(1);
      const snapshot = await reopenedSession.inspect({
        agentId: reopened.identity.id,
        sessionId: parseSessionId(sessionId),
      });
      expect(snapshot?.navigation).toMatchObject({
        revision: 8,
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        branches: [
          { branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: 'branch-request-6' },
          { branchId: childBranchId, headTurnId: 'branch-request-5' },
        ],
      });
      expect(snapshot?.turns).toHaveLength(6);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it('applies the assembled request timeout and reports it distinctly', async () => {
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const actorCatalog = createActorCatalog({
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

    await expect(
      agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, { message: 'wait' })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_TIMEOUT' })
    );
    const serializedTrace = JSON.stringify(trace.inspect({ agentRunId: 'timeout-run' }).events);
    expect(serializedTrace).toContain('MODEL_INVOCATION_TIMEOUT');
    expect(serializedTrace).not.toContain('timed out');
  });
});
