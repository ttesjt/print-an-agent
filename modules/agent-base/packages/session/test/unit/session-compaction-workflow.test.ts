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
import { defineProviderModelReference } from '@ta-agent/base-model';
import { RUN_WORKFLOW } from '@ta-agent/base-workflow';
import { describe, expect, it } from 'vitest';
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

function createTestResponsibilities(complete?: ActorDirectHandler) {
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
            message: Object.freeze({
              role: 'assistant',
              text: 'unused',
              provider: model.provider,
              model: model.model,
              stopReason: 'stop',
              usage: Object.freeze({
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 2,
              }),
              timestamp: 1,
            }),
          })
        )),
  });
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

function createTwoTurnSnapshot(agentId: SessionSnapshot['agentId']): SessionSnapshot {
  const sessionId = parseSessionId('session');
  const turns = ['one', 'two'].map((name, index) =>
    Object.freeze({
      status: 'completed' as const,
      turnId: parseTurnId(name),
      branchId: DEFAULT_SESSION_BRANCH_ID,
      userMessage: Object.freeze({
        role: 'user' as const,
        text: `user-${name}`,
        timestamp: index * 2 + 1,
      }),
      assistantMessage: Object.freeze({
        role: 'assistant' as const,
        text: `assistant-${name}`,
        provider: model.provider,
        model: model.model,
        stopReason: 'stop' as const,
        usage: Object.freeze({
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        }),
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
});
