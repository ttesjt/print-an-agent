import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSessionNavigationStepOverrides,
  createSessionNavigationWorkflow,
  MemorySessionAdapter,
  type SessionNavigationAgentContext,
  type SessionNavigationResources,
} from '../../src/index.js';

describe('Session navigation Workflow contracts', () => {
  it('keeps unresolved raw leaf Steps as stable fail-fast placeholders', async () => {
    const identity = defineAgentIdentity({ id: 'navigation-workflow-agent' });
    const resources: SessionNavigationResources = Object.freeze({
      session: new MemorySessionAdapter(),
    });
    const workflow = createSessionNavigationWorkflow({
      resources,
      createRunId: () => 'navigation-workflow-run',
    });
    const context: SessionNavigationAgentContext = {
      identity,
      runId: 'navigation-agent-run',
      input: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
      signal: new AbortController().signal,
      resources,
    };

    await expect(workflow.run(context)).rejects.toMatchObject({
      code: 'SESSION_NAVIGATION_NOT_CONFIGURED',
      stepName: 'validateSessionNavigation',
    });
  });

  it('inspects through ordered default Steps without mutating navigation authority', async () => {
    const identity = defineAgentIdentity({ id: 'navigation-inspect-agent' });
    const session = new MemorySessionAdapter({ clock: () => 1 });
    await session.resolve({ agentId: identity.id, requestedSessionId: 'session' });
    const resources: SessionNavigationResources = Object.freeze({ session });
    const workflow = createSessionNavigationWorkflow({
      resources,
      stepOverrides: createDefaultSessionNavigationStepOverrides(),
      createRunId: () => 'navigation-workflow-run',
    });
    const context: SessionNavigationAgentContext = {
      identity,
      runId: 'navigation-agent-run',
      input: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
      signal: new AbortController().signal,
      resources,
    };

    await expect(workflow.run(context)).resolves.toMatchObject({
      status: 'completed',
      result: {
        status: 'inspected',
        navigation: { revision: 0, selectedBranchId: 'main' },
      },
    });
    await expect(
      session.resolve({ agentId: identity.id, requestedSessionId: 'session' })
    ).resolves.toMatchObject({ navigationRevision: 0 });
  });
});
