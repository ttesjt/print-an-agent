import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
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
  type RequestWorkflowState,
} from '@print-an-agent/base-request';
import { bindAgentWorkflow, type BaseAgentRunContext } from '@print-an-agent/base-runtime';
import {
  createDefaultSessionCompactionStepOverrides,
  defineCompactSessionInput,
  createSessionCompactionWorkflow,
  createShouldCompactSessionCondition,
  DEFAULT_SESSION_COMPACTION_POLICY,
  DEFAULT_SESSION_BRANCH_ID,
  parseTurnId,
  type SessionCompactionState,
} from '@print-an-agent/base-session';
import { DEFAULT_TOOL_EXECUTION_POLICY, EMPTY_TOOL_REGISTRY } from '@print-an-agent/base-tool';
import {
  createTokenCounter,
  defineAssistantModelMessage,
  TEXT_TOKEN_INPUT_CONTRACT,
  type ActorEngineInput,
} from '@print-an-agent/model-invocation-core';
import { createPiFauxRuntime } from '@print-an-agent/model-invocation-pi';
import { STEP_CARDINALITY, SKIP_STEP, Workflow } from '@print-an-agent/workflow-core';
import { sessionFixture } from './session-port.ts';

function routing(engine: ActorEngineInput) {
  return createResponsibilityRouter({
    actorCatalog: createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: engine.id }],
      engines: [engine],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
  });
}

function message(text: string) {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    timestamp: 1,
    stopReason: 'stop',
    provenance: { kind: 'engine-defined', type: 'release.fixture', evidence: {} },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
}

function requestFixture() {
  const session = sessionFixture();
  const phases: string[] = [];
  const chunks: string[] = [];
  const provider = createPiFauxRuntime({
    responses: [{ status: 'success', text: 'packed answer' }],
  });
  const workflow = createRequestWorkflow<
    RequestWorkflowInput,
    DefaultRequestWorkflowContext['state'],
    DefaultRequestWorkflowContext['resources'],
    AgentResponse
  >({
    resources: {
      session: session.port,
      requestJournal: {
        claim: () => Promise.reject(new Error('Unexpected replay claim.')),
        complete: () => Promise.reject(new Error('Unexpected replay commit.')),
        fail: () => Promise.reject(new Error('Unexpected replay cleanup.')),
      },
      responsibilities: routing(provider.actorEngine),
      instructionContributors: [() => 'Answer briefly.'],
      toolRegistry: EMPTY_TOOL_REGISTRY,
      productToolAllowList: [],
      runtimeToolAllowList: [],
      toolExecutionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
      policy: DEFAULT_REQUEST_POLICY,
      clock: () => 1,
      createOutputSink: () => ({
        open: (event) => {
          assert.equal(event.requestId, 'business-request');
          phases.push('open');
          return Promise.resolve();
        },
        write: (event) => {
          phases.push(event.type);
          if (event.type === 'text-delta') chunks.push(event.delta);
          return Promise.resolve();
        },
        close: () => {
          phases.push('close');
          return Promise.resolve();
        },
        fail: () => Promise.reject(new Error('Unexpected output failure.')),
      }),
    },
    createState: ({ input }) => createDefaultRequestState(input),
    stepOverrides: {
      ...createDefaultRequestStepOverrides(),
      captureReasoningPresentation: SKIP_STEP,
    },
    lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
  });
  const input: RequestWorkflowInput = {
    agentId: session.reference.agentId,
    requestId: 'business-request',
    requestInput: { message: 'hello' },
  };
  return { workflow, input, session, phases, chunks };
}

test('packed official Request Steps accept business input without an Agent owner', async () => {
  const { workflow, input, session, phases, chunks } = requestFixture();
  const result = await workflow.run({ input });
  assert.ok(result);
  assert.equal(result.message.text, 'packed answer');
  assert.equal(result.requestId, 'business-request');
  assert.equal(session.completed.length, 1);
  assert.equal(phases[0], 'open');
  assert.equal(phases.at(-1), 'close');
  assert.ok(phases.length > 2);
  assert.ok(phases.slice(1, -1).every((phase) => phase === 'text-delta'));
  assert.equal(chunks.join(''), result.message.text);
});

test('packed Compaction Workflow retries a measured draft and publishes without an Agent owner', async () => {
  const turns = Array.from({ length: 4 }, (_, index) => ({
    status: 'completed' as const,
    branchId: DEFAULT_SESSION_BRANCH_ID,
    turnId: parseTurnId(`turn-${index + 1}`),
    ...(index === 0 ? {} : { parentTurnId: parseTurnId(`turn-${index}`) }),
    userMessage: { role: 'user' as const, text: `fact-${index}`, timestamp: index },
    assistantMessage: message(`answer-${index}`),
  }));
  const session = sessionFixture(turns);
  const provider = createPiFauxRuntime({
    responses: [
      { status: 'success', text: 'x'.repeat(20) },
      { status: 'success', text: 'short' },
    ],
  });
  const workflow = createSessionCompactionWorkflow({
    resources: {
      session: session.port,
      responsibilities: routing(provider.actorEngine),
      instructions: 'Compact the conversation.',
      clock: () => 1,
      tokenCounter: createTokenCounter({
        measurementRef: 'fixture:utf16-code-units',
        inputContract: TEXT_TOKEN_INPUT_CONTRACT,
        measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
      }),
      policy: {
        ...DEFAULT_SESSION_COMPACTION_POLICY,
        maxContextTokens: 10,
        target: { maxTokens: 10 },
      },
    },
    condition: createShouldCompactSessionCondition(),
    stepOverrides: createDefaultSessionCompactionStepOverrides(),
  });
  const result = await workflow.run({
    input: {
      agentId: session.reference.agentId,
      compactionInput: { sessionId: session.reference.sessionId },
    },
  });
  assert.equal(result?.status, 'compacted');
  assert.equal(provider.inspect().callCount, 2);
  assert.equal(session.compactions.length, 1);
  assert.equal(session.compactions[0]?.context.text, 'short');
});

test('packed bindings isolate source result ownership and reject async projection before admission', async () => {
  type Run = BaseAgentRunContext<string, AgentResponse>;
  const { workflow, input } = requestFixture();
  const run: Run = {
    identity: defineAgentIdentity({ id: input.agentId }),
    operationName: 'request',
    runId: input.requestId,
    input: 'hello',
    signal: new AbortController().signal,
    operations: { invoke: () => Promise.reject(new Error('No callable operations.')) },
  };
  const binding = bindAgentWorkflow({
    workflow,
    projectInput: (_source: Run) => input,
    applyResult: (source, result) => {
      if (result !== undefined) source.output = result;
    },
  });
  const result = await binding.run(run);
  assert.equal(Object.hasOwn(run, 'output'), false);
  await assert.rejects(result.applyTo({ ...run }), { code: 'WORKFLOW_RESULT_CONTEXT_MISMATCH' });
  await result.applyTo(run);
  assert.equal(run.output?.message.text, 'packed answer');
  let admitted = false;
  const broad = new Workflow<'execute', unknown, undefined, undefined, string>({
    name: 'broad',
    resources: undefined,
    entryStep: 'execute',
    createState: () => {
      admitted = true;
      return undefined;
    },
    createResult: () => 'wrong success',
    stepDefinitions: {
      execute: {
        cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
        skippable: false,
        step: () => Promise.resolve(),
      },
    },
  });
  for (const projectInput of [
    async (_run: Run) => {
      await Promise.resolve();
      throw new Error('projection rejected');
    },
    (_run: Run): unknown => runInNewContext('Promise.reject(new Error("other realm"))'),
  ]) {
    const invalid = bindAgentWorkflow({
      workflow: broad,
      projectInput,
      applyResult: () => assert.fail('must not apply'),
    });
    await assert.rejects(invalid.run(run), { code: 'WORKFLOW_INPUT_PROJECTION_ASYNC' });
  }
  assert.equal(admitted, false);
  assert.equal(run.output?.message.text, 'packed answer');
  await new Promise<void>((resolve) => setImmediate(resolve));
});

export function verifyStateContracts(
  request: RequestWorkflowState,
  compaction: SessionCompactionState
): void {
  // @ts-expect-error Official Request state has no Agent owner.
  void request.agentRun;
  // @ts-expect-error The effective signal belongs to Core Context, not business state.
  void request.signal;
  // @ts-expect-error Compaction state has no Agent owner.
  void compaction.agentRun;
  // @ts-expect-error Agent operation invocation is not an implicit Compaction capability.
  void compaction.operations;
}

test('packed compaction input validation rejects unknown fields and accessors without executing them', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'sessionId', {
    enumerable: true,
    get: () => {
      reads += 1;
      return 'session';
    },
  });
  for (const input of [null, { sessionId: 'session', extra: true }, accessor]) {
    assert.throws(() => defineCompactSessionInput(input), { code: 'SESSION_COMPACTION_INVALID' });
  }
  assert.equal(reads, 0);
});
