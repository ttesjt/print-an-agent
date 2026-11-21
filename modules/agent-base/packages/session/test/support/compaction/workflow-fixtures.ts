import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  MAIN_ACTOR_ID,
} from '@print-an-agent/agent-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  defineActorEngine,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
  type ActorDirectHandler,
} from '@print-an-agent/model-invocation-core';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  DEFAULT_SESSION_COMPACTION_POLICY,
  parseSessionId,
  parseTurnId,
  type SessionCompactionResources,
  type SessionCompactionWorkflowInput,
  type SessionSnapshot,
} from '../../../src/index.js';
import { createSessionPortStub } from '../session-port-stub.js';
import { testTextCounter } from './text-token-counter.js';

const model = defineProviderModelReference({ provider: 'test', model: 'test-model' });

export function createTestResponsibilities(
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
    actorCatalog: createAgentActorCatalog({
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

export function rejectWhenAborted(signal: AbortSignal): Promise<never> {
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

export function createTwoTurnSnapshot(agentId: SessionSnapshot['agentId']): SessionSnapshot {
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

export function createRunnableCompaction(options: {
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
