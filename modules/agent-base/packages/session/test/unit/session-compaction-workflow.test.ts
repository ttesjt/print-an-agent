import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { defineActorEngine, type ActorDirectHandler } from '@print-an-agent/model-invocation-core';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
} from '@print-an-agent/model-invocation-core';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_COMPACTION_POLICY,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  parseTurnId,
  type SessionCompactionWorkflowInput,
  type SessionCompactionResources,
  type SessionCompactionState,
  type SessionSnapshot,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';
import { testTextCounter } from '../support/text-token-counter.js';

const model = defineProviderModelReference({ provider: 'test', model: 'test-model' });

function createTestResponsibilities(
  complete?: ActorDirectHandler,
  actorTimeoutMilliseconds?: number
) {
  const engine = defineActorEngine({
    id: 'test-engine',
    capabilities: {
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    },
    complete:
      complete ??
      (() =>
        Promise.resolve(
          Object.freeze({
            message: defineAssistantModelMessage({
              role: 'assistant',
              text: 'unused',
              provenance: defineProviderModelExecutionProvenance(model),
              stopReason: 'stop',
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 2,
              },
              timestamp: 1,
            }),
          })
        )),
  });
  return createResponsibilityRouter({
    actorCatalog: createActorCatalog({
      actors: [
        {
          id: MAIN_ACTOR_ID,
          engineId: engine.id,
          ...(actorTimeoutMilliseconds === undefined
            ? {}
            : { invocationPolicy: { timeoutMilliseconds: actorTimeoutMilliseconds } }),
        },
      ],
      engines: [engine],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
  });
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortFailure(signal));
      return;
    }
    signal.addEventListener('abort', () => reject(abortFailure(signal)), { once: true });
  });
}

function abortFailure(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Session compaction was aborted.', { cause: signal.reason });
}

afterEach(() => {
  vi.useRealTimers();
});

function createTwoTurnSnapshot(agentId: SessionSnapshot['agentId']): SessionSnapshot {
  const sessionId = parseSessionId('session');
  const turns = ['one', 'two'].map((name, index) =>
    Object.freeze({
      status: 'completed' as const,
      turnId: parseTurnId(name),
      branchId: DEFAULT_SESSION_BRANCH_ID,
      ...(index === 0 ? {} : { parentTurnId: parseTurnId('one') }),
      userMessage: Object.freeze({
        role: 'user' as const,
        text: `user-${name}`,
        timestamp: index * 2 + 1,
      }),
      assistantMessage: defineAssistantModelMessage({
        role: 'assistant' as const,
        text: `assistant-${name}`,
        provenance: defineProviderModelExecutionProvenance(model),
        stopReason: 'stop' as const,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
        timestamp: index * 2 + 2,
      }),
    })
  );
  return Object.freeze({
    agentId,
    sessionId,
    navigation: Object.freeze({
      agentId,
      sessionId,
      revision: 0,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: Object.freeze([
        Object.freeze({
          branchId: DEFAULT_SESSION_BRANCH_ID,
          headTurnId: parseTurnId('two'),
          createdAt: 0,
        }),
      ]),
    }),
    turns: Object.freeze(turns),
  });
}

function createRunnableCompaction(options: {
  readonly identityId: string;
  readonly complete: ActorDirectHandler;
  readonly timeoutMilliseconds: number | null;
  readonly actorTimeoutMilliseconds?: number;
  readonly signal: AbortSignal;
}) {
  const identity = defineAgentIdentity({ id: options.identityId });
  const snapshot = createTwoTurnSnapshot(identity.id);
  const resources: SessionCompactionResources = Object.freeze({
    session: createSessionPortStub({
      inspect: () => Promise.resolve(snapshot),
      readCompaction: () => Promise.resolve(undefined),
    }),
    responsibilities: createTestResponsibilities(
      options.complete,
      options.actorTimeoutMilliseconds
    ),
    instructions: 'Compact.',
    tokenCounter: testTextCounter(),
    policy: Object.freeze({
      ...DEFAULT_SESSION_COMPACTION_POLICY,
      minimumCompletedTurns: 2,
      retainRecentTurns: 0,
      timeoutMilliseconds: options.timeoutMilliseconds,
    }),
    clock: () => 1,
  });
  const workflow = createSessionCompactionWorkflow({
    resources,
    stepOverrides: createDefaultSessionCompactionStepOverrides(),
    condition: () => Promise.resolve(RUN_WORKFLOW),
    createRunId: () => 'workflow-run',
  });
  const input: SessionCompactionWorkflowInput = {
    agentId: identity.id,
    compactionInput: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
  };
  return Object.freeze({ input, signal: options.signal, workflow });
}

describe('Session compaction Workflow contracts', () => {
  it('selects only declared business input and never retains execution context extras', async () => {
    const identity = defineAgentIdentity({ id: 'narrow-compaction' });
    let state: SessionCompactionState | undefined;
    const workflow = createSessionCompactionWorkflow({
      resources: {
        session: createSessionPortStub(),
        responsibilities: createTestResponsibilities(),
        instructions: 'Compact.',
        policy: DEFAULT_SESSION_COMPACTION_POLICY,
        clock: () => 1,
      },
      stepOverrides: {
        runSessionCompaction: (context) => {
          state = context.state;
          context.state.outcome = {
            status: 'skipped',
            sessionId: 'session',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            reason: 'not-needed',
          };
          return Promise.resolve();
        },
      },
    });
    const input = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session' }),
      signal: new AbortController().signal,
      operations: { invoke: () => Promise.reject(new Error('Not a Workflow capability.')) },
      output: 'not a Workflow result',
    };
    await expect(workflow.run({ input })).resolves.toMatchObject({ status: 'skipped' });
    expect(state).not.toBe(input);
    expect(state).toMatchObject({ agentId: input.agentId, compactionInput: input.compactionInput });
    for (const key of ['agentRun', 'signal', 'operations', 'output', 'traceEmitter']) {
      expect(state).not.toHaveProperty(key);
    }
    expectTypeOf<SessionCompactionState>().not.toHaveProperty('agentRun');
    expectTypeOf<SessionCompactionState>().not.toHaveProperty('signal');
    expect(input).not.toHaveProperty('outcome');
  });

  it('keeps unresolved raw leaf Steps as stable fail-fast placeholders', async () => {
    const identity = defineAgentIdentity({ id: 'workflow-agent' });
    const resources: SessionCompactionResources = Object.freeze({
      session: createSessionPortStub(),
      responsibilities: createTestResponsibilities(),
      instructions: 'Compact.',
      policy: DEFAULT_SESSION_COMPACTION_POLICY,
      clock: () => 1,
    });
    const workflow = createSessionCompactionWorkflow({
      resources,
      condition: () => Promise.resolve(RUN_WORKFLOW),
      createRunId: () => 'workflow-run',
    });
    const input: SessionCompactionWorkflowInput = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
    };

    await expect(workflow.run({ input })).rejects.toMatchObject({
      code: 'SESSION_COMPACTION_NOT_CONFIGURED',
      stepName: 'inspectSession',
    });
  });

  it('returns an explicit skip when eligibility changes between Condition and Steps', async () => {
    const identity = defineAgentIdentity({ id: 'race-agent' });
    const snapshot = createTwoTurnSnapshot(identity.id);
    const session = createSessionPortStub({
      inspect: () => Promise.resolve(snapshot),
      readCompaction: () => Promise.resolve(undefined),
    });
    const resources: SessionCompactionResources = Object.freeze({
      session,
      responsibilities: createTestResponsibilities(() => {
        throw new Error('must not run');
      }),
      instructions: 'Compact.',
      policy: DEFAULT_SESSION_COMPACTION_POLICY,
      clock: () => 1,
    });
    const workflow = createSessionCompactionWorkflow({
      resources,
      stepOverrides: createDefaultSessionCompactionStepOverrides(),
      condition: () => Promise.resolve(RUN_WORKFLOW),
      createRunId: () => 'workflow-run',
    });
    const input: SessionCompactionWorkflowInput = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
    };

    await expect(workflow.run({ input })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'not-needed',
    });
  });

  it('preserves a child Actor timeout instead of relabelling it as compaction timeout', async () => {
    vi.useFakeTimers();
    const fixture = createRunnableCompaction({
      identityId: 'actor-timeout-agent',
      complete: (request) => rejectWhenAborted(request.signal),
      timeoutMilliseconds: null,
      actorTimeoutMilliseconds: 10,
      signal: new AbortController().signal,
    });

    const run = fixture.workflow.run({
      input: fixture.input,
      signal: fixture.signal,
    });
    const expectation = expect(run).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10);

    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });
});
