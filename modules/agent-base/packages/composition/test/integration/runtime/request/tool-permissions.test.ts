import {
  BUILT_IN_RESPONSIBILITIES,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { MemoryAgentTraceAdapter, MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import { REQUEST_WORKFLOW_NAME } from '@print-an-agent/base-request';
import { parseSessionId, SESSION_COMPACTION_WORKFLOW_NAME } from '@print-an-agent/base-session';
import {
  AgentToolError,
  createToolRegistry,
  defineTool,
  type ToolExecutionRequest,
} from '@print-an-agent/base-tool';
import { expect, it, vi } from 'vitest';
import {
  createDeterministicAgentAPI,
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from '../../../../src/index.js';
import { responsibilitiesAllowingTools } from '../../../support/runtime/agent-api.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';
import { LifecycleRecordingOutputSink } from '../../../support/runtime/output-sinks.js';

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
