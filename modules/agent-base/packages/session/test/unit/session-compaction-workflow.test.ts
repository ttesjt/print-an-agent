import { defineAgentIdentity } from '@ta-agent/base-identity';
import { defineProviderModelReference } from '@ta-agent/base-model';
import { RUN_WORKFLOW } from '@ta-agent/base-workflow';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_COMPACTION_POLICY,
  MemorySessionAdapter,
  parseTurnId,
  type SessionCompactionAgentContext,
  type SessionCompactionResources,
} from '../../src/index.js';
import { assistantMessage, userMessage } from '../support/session-port-contract.js';

describe('Session compaction Workflow contracts', () => {
  it('keeps unresolved raw leaf Steps as stable fail-fast placeholders', async () => {
    const identity = defineAgentIdentity({ id: 'workflow-agent' });
    const resources: SessionCompactionResources = Object.freeze({
      session: new MemorySessionAdapter(),
      runtime: {
        compact: () => Promise.resolve(Object.freeze({ text: 'unused' })),
      },
      modelReference: defineProviderModelReference({ provider: 'faux', model: 'faux-model' }),
      instructions: 'Compact.',
      policy: DEFAULT_SESSION_COMPACTION_POLICY,
      clock: () => 1,
    });
    const workflow = createSessionCompactionWorkflow({
      resources,
      condition: () => Promise.resolve(RUN_WORKFLOW),
      createRunId: () => 'workflow-run',
    });
    const context: SessionCompactionAgentContext = {
      identity,
      runId: 'agent-run',
      input: Object.freeze({ sessionId: 'session' }),
      output: Object.freeze({
        status: 'skipped',
        sessionId: 'session',
        reason: 'not-needed',
      }),
      signal: new AbortController().signal,
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
    const reference = await session.resolve({
      agentId: identity.id,
      requestedSessionId: 'session',
    });
    for (const [index, turnName] of ['one', 'two'].entries()) {
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
      runtime: {
        compact: () => Promise.resolve(Object.freeze({ text: 'must not run' })),
      },
      modelReference: defineProviderModelReference({ provider: 'faux', model: 'faux-model' }),
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
    const context: SessionCompactionAgentContext = {
      identity,
      runId: 'agent-run',
      input: Object.freeze({ sessionId: 'session' }),
      output: Object.freeze({
        status: 'skipped',
        sessionId: 'session',
        reason: 'not-needed',
      }),
      signal: new AbortController().signal,
      resources,
    };

    await expect(workflow.run(context)).resolves.toMatchObject({
      status: 'completed',
      result: { status: 'skipped', reason: 'not-needed' },
    });
    expect(await session.readCompaction(reference)).toBeUndefined();
  });
});
