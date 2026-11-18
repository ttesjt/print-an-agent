import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { parseAgentId } from '@print-an-agent/base-identity';
import {
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  createDefaultRequestState,
  createDefaultRequestStepOverrides,
  createRequestWorkflow,
  DEFAULT_REQUEST_POLICY,
  failRequest,
  releaseRequestExecution,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestWorkflowInput,
} from '@print-an-agent/base-request';
import { DEFAULT_TOOL_EXECUTION_POLICY, EMPTY_TOOL_REGISTRY } from '@print-an-agent/base-tool';
import type { ActorEngineInteractionRequest } from '@print-an-agent/model-invocation-core';
import { expect, it, vi } from 'vitest';
import { interactionMessage } from '../support/interaction-agent.js';

function independentRequest() {
  const session = new MemorySessionAdapter();
  const sinks: MemoryOutputSink[] = [];
  const histories: string[][] = [];
  const interact = vi.fn(async (request: ActorEngineInteractionRequest) => {
    histories.push(request.history.map((message) => message.text));
    const message = interactionMessage(`reply:${request.prompt.text}`);
    await request.emit({ type: 'reasoning-delta', delta: 'readable thinking' });
    await request.emit({ type: 'text-delta', delta: message.text });
    await request.emit({ type: 'assistant-complete', message });
    return { message };
  });
  const workflow = createRequestWorkflow<
    RequestWorkflowInput,
    DefaultRequestWorkflowContext['state'],
    DefaultRequestWorkflowContext['resources'],
    AgentResponse
  >({
    resources: {
      session,
      requestJournal: new MemoryRequestJournalAdapter(),
      responsibilities: createResponsibilityRouter({
        actorCatalog: createActorCatalog({
          actors: [{ id: MAIN_ACTOR_ID, engineId: 'independent' }],
          engines: [
            {
              id: 'independent',
              capabilities: {
                invocationModes: ['interaction'],
                inputMediaTypes: ['text'],
                interaction: { streamable: true },
                toolCalling: false,
                structuredOutput: false,
                cancellation: true,
              },
              interact,
            },
          ],
        }),
        responsibilityCatalog: createResponsibilityCatalog({
          responsibilities: BUILT_IN_RESPONSIBILITIES,
        }),
      }),
      instructionContributors: [() => 'Respond concisely.'],
      toolRegistry: EMPTY_TOOL_REGISTRY,
      productToolAllowList: [],
      runtimeToolAllowList: [],
      toolExecutionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
      policy: DEFAULT_REQUEST_POLICY,
      clock: () => 1,
      createOutputSink: () => {
        const sink = new MemoryOutputSink();
        sinks.push(sink);
        return sink;
      },
    },
    createState: ({ input }) => createDefaultRequestState(input),
    stepOverrides: createDefaultRequestStepOverrides(),
    lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
  });
  return { workflow, session, sinks, histories, interact };
}

it('runs two session-aware requests and replay with business input, without constructing an Agent', async () => {
  const fixture = independentRequest();
  const agentId = parseAgentId('independent');
  const first = await fixture.workflow.run({
    input: { agentId, requestId: 'first', requestInput: { message: 'hello' } },
  });
  if (first === undefined) throw new Error('Expected a completed Request.');
  const second = await fixture.workflow.run({
    input: {
      agentId,
      requestId: 'second',
      requestInput: { sessionId: first.sessionId, message: 'again', idempotencyKey: 'retry' },
    },
  });
  const replay = await fixture.workflow.run({
    input: {
      agentId,
      requestId: 'replay-attempt',
      requestInput: { sessionId: first.sessionId, message: 'again', idempotencyKey: 'retry' },
    },
  });
  expect(first).toMatchObject({ requestId: 'first', message: { text: 'reply:hello' } });
  expect(second).toMatchObject({ requestId: 'second', message: { text: 'reply:again' } });
  expect(replay).toEqual(second);
  expect(fixture.interact).toHaveBeenCalledTimes(2);
  expect(fixture.histories).toEqual([[], ['hello', 'reply:hello']]);
  expect(fixture.sinks.map((sink) => sink.inspect().status)).toEqual([
    'closed',
    'closed',
    'closed',
  ]);
  const snapshot = await fixture.session.inspect({ agentId, sessionId: first.sessionId });
  expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
});

it('keeps raw input validation in the request Step before creating a Session or sink', async () => {
  const fixture = independentRequest();
  const resolve = vi.spyOn(fixture.session, 'resolve');
  await expect(
    fixture.workflow.run({
      input: {
        agentId: parseAgentId('independent'),
        requestId: 'invalid',
        // @ts-expect-error Exercise a JavaScript caller's invalid raw business input.
        requestInput: null,
      },
    })
  ).rejects.toMatchObject({ code: 'REQUEST_INPUT_INVALID' });
  expect(resolve).not.toHaveBeenCalled();
  expect(fixture.sinks).toHaveLength(0);
  expect(fixture.interact).not.toHaveBeenCalled();
});
