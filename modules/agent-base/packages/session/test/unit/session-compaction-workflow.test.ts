import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  defineActorEngine,
  MAIN_ACTOR_ID,
  type ActorDirectHandler,
} from '@ta-agent/base-actor';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
} from '@ta-agent/base-model';
import { RUN_WORKFLOW } from '@ta-agent/base-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_COMPACTION_POLICY,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  parseTurnId,
  type SessionCompactionAgentRunContext,
  type SessionCompactionResources,
  type SessionSnapshot,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';

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
  const context: SessionCompactionAgentRunContext = {
    identity,
    operationName: 'compactSession',
    runId: 'agent-run',
    input: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
    output: Object.freeze({
      status: 'skipped',
      sessionId: 'session',
      branchId: DEFAULT_SESSION_BRANCH_ID,
      reason: 'not-needed',
    }),
    signal: options.signal,
    operations: Object.freeze({
      invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
    }),
    resources,
  };
  return Object.freeze({ context, workflow });
}

describe('Session compaction Workflow contracts', () => {
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
    const context: SessionCompactionAgentRunContext = {
      identity,
      operationName: 'compactSession',
      runId: 'agent-run',
      input: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
      output: Object.freeze({
        status: 'skipped',
        sessionId: 'session',
        branchId: DEFAULT_SESSION_BRANCH_ID,
        reason: 'not-needed',
      }),
      signal: new AbortController().signal,
      operations: Object.freeze({
        invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
      }),
      resources,
    };

    await expect(workflow.run(context)).rejects.toMatchObject({
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
    const context: SessionCompactionAgentRunContext = {
      identity,
      operationName: 'compactSession',
      runId: 'agent-run',
      input: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
      output: Object.freeze({
        status: 'skipped',
        sessionId: 'session',
        branchId: DEFAULT_SESSION_BRANCH_ID,
        reason: 'not-needed',
      }),
      signal: new AbortController().signal,
      operations: Object.freeze({
        invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
      }),
      resources,
    };

    await expect(workflow.run(context)).resolves.toMatchObject({
      status: 'completed',
      result: { status: 'skipped', reason: 'not-needed' },
    });
  });

  it('maps only its own explicit deadline to SESSION_COMPACTION_TIMEOUT', async () => {
    vi.useFakeTimers();
    const parentController = new AbortController();
    const fixture = createRunnableCompaction({
      identityId: 'timeout-agent',
      complete: (request) => rejectWhenAborted(request.signal),
      timeoutMilliseconds: 25,
      signal: parentController.signal,
    });

    const run = fixture.workflow.run(fixture.context);
    const expectation = expect(run).rejects.toMatchObject({
      code: 'SESSION_COMPACTION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
    expect(parentController.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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

    const run = fixture.workflow.run(fixture.context);
    const expectation = expect(run).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10);

    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });
});
