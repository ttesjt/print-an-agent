import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSessionNavigationStepOverrides,
  createSessionNavigationWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  type SessionNavigationAgentRunContext,
  type SessionNavigationResources,
  type SessionSnapshot,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';

describe('Session navigation Workflow contracts', () => {
  it('keeps unresolved raw leaf Steps as stable fail-fast placeholders', async () => {
    const identity = defineAgentIdentity({ id: 'navigation-workflow-agent' });
    const resources: SessionNavigationResources = Object.freeze({
      session: createSessionPortStub(),
    });
    const workflow = createSessionNavigationWorkflow({
      resources,
      createRunId: () => 'navigation-workflow-run',
    });
    const context: SessionNavigationAgentRunContext = {
      identity,
      operationName: 'navigateSession',
      runId: 'navigation-agent-run',
      input: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
      signal: new AbortController().signal,
      operations: Object.freeze({
        invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
      }),
      resources,
    };

    await expect(workflow.run(context)).rejects.toMatchObject({
      code: 'SESSION_NAVIGATION_NOT_CONFIGURED',
      stepName: 'validateSessionNavigation',
    });
  });

  it('inspects through ordered default Steps without mutating navigation authority', async () => {
    const identity = defineAgentIdentity({ id: 'navigation-inspect-agent' });
    const sessionId = parseSessionId('session');
    const snapshot: SessionSnapshot = Object.freeze({
      agentId: identity.id,
      sessionId,
      navigation: Object.freeze({
        agentId: identity.id,
        sessionId,
        revision: 0,
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        branches: Object.freeze([
          Object.freeze({ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }),
        ]),
      }),
      turns: Object.freeze([]),
    });
    const inspectCalls: unknown[] = [];
    const session = createSessionPortStub({
      inspect: (reference) => {
        inspectCalls.push(reference);
        return Promise.resolve(snapshot);
      },
    });
    const resources: SessionNavigationResources = Object.freeze({ session });
    const workflow = createSessionNavigationWorkflow({
      resources,
      stepOverrides: createDefaultSessionNavigationStepOverrides(),
      createRunId: () => 'navigation-workflow-run',
    });
    const context: SessionNavigationAgentRunContext = {
      identity,
      operationName: 'navigateSession',
      runId: 'navigation-agent-run',
      input: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
      signal: new AbortController().signal,
      operations: Object.freeze({
        invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
      }),
      resources,
    };

    await expect(workflow.run(context)).resolves.toMatchObject({
      status: 'completed',
      result: {
        status: 'inspected',
        navigation: { revision: 0, selectedBranchId: 'main' },
      },
    });
    expect(inspectCalls).toEqual([{ agentId: identity.id, sessionId }]);
  });
});
