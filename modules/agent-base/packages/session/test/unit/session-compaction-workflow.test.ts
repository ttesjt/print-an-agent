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
import { RUN_WORKFLOW } from '@ta-agent/base-workflow';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_COMPACTION_POLICY,
  DEFAULT_SESSION_BRANCH_ID,
  MemorySessionAdapter,
  parseTurnId,
  type SessionCompactionAgentRunContext,
  type SessionCompactionResources,
} from '../../src/index.js';
import { assistantMessage, userMessage } from '../support/session-port-contract.js';

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
      (() => Promise.resolve(Object.freeze({ message: assistantMessage('unused', 1) }))),
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

describe('Session compaction Workflow contracts', () => {
  it('keeps unresolved raw leaf Steps as stable fail-fast placeholders', async () => {
    const identity = defineAgentIdentity({ id: 'workflow-agent' });
    const resources: SessionCompactionResources = Object.freeze({
      session: new MemorySessionAdapter(),
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
    const session = new MemorySessionAdapter();
    let reference = await session.resolve({
      agentId: identity.id,
      requestedSessionId: 'session',
    });
    for (const [index, turnName] of ['one', 'two'].entries()) {
      reference = await session.resolve({
        agentId: identity.id,
        requestedSessionId: 'session',
      });
      const turnId = parseTurnId(turnName);
      await session.beginTurn({
        ...reference,
        turnId,
        userMessage: userMessage(`user-${turnName}`, index * 2 + 1),
      });
      await session.completeTurn({
        ...reference,
        turnId,
        assistantMessage: assistantMessage(`assistant-${turnName}`, index * 2 + 2),
      });
    }
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
    expect(await session.readCompaction(reference)).toBeUndefined();
  });
});
