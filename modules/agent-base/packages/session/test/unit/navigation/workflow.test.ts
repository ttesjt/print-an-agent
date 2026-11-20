import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { createAgentTraceEmitter, type AgentTraceEvent } from '@print-an-agent/base-observability';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultSessionNavigationStepOverrides,
  createSessionNavigationWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionExecutionId,
  parseSessionId,
  type SessionNavigationResources,
  type SessionNavigationWorkflowInput,
  type SessionSnapshot,
} from '../../../src/index.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

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
    const context: SessionNavigationWorkflowInput = {
      agentId: identity.id,
      navigation: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
    };

    await expect(workflow.run({ input: context })).rejects.toMatchObject({
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
    const context: SessionNavigationWorkflowInput = {
      agentId: identity.id,
      navigation: Object.freeze({ sessionId: 'session', operation: 'inspect' }),
    };

    await expect(workflow.run({ input: context })).resolves.toMatchObject({
      status: 'inspected',
      navigation: { revision: 0, selectedBranchId: 'main' },
    });
    expect(inspectCalls).toEqual([{ agentId: identity.id, sessionId }]);
  });

  it('preserves a committed navigation result, trace and lease release after late cancellation', async () => {
    const agentId = defineAgentIdentity({ id: 'navigation-commit-agent' }).id;
    const sessionId = parseSessionId('session');
    const navigation = {
      agentId,
      sessionId,
      revision: 0,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }],
    };
    const source = new AbortController();
    const lease = { agentId, sessionId, executionId: parseSessionExecutionId('execution') };
    const release = vi.fn(() => Promise.resolve());
    const session = {
      ...createSessionPortStub({
        inspect: () => Promise.resolve({ agentId, sessionId, navigation, turns: [] }),
        applyNavigation: () => {
          source.abort(new Error('cancel after commit'));
          return Promise.resolve({
            operation: 'select',
            affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
            navigation: { ...navigation, revision: 1 },
          });
        },
      }),
      acquireSessionExecution: () => Promise.resolve(lease),
      releaseSessionExecution: release,
    };
    const events: AgentTraceEvent[] = [];
    const traceEmitter = createAgentTraceEmitter({
      agentId,
      agentRunId: 'navigation-observation',
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    });
    const workflow = createSessionNavigationWorkflow({
      resources: { session },
      stepOverrides: createDefaultSessionNavigationStepOverrides(),
      createRunId: () => 'navigation-workflow-run',
    });

    await expect(
      workflow.run({
        input: {
          agentId,
          traceEmitter,
          navigation: {
            sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 0,
          },
        },
        signal: source.signal,
      })
    ).resolves.toMatchObject({ status: 'selected', sessionId, revision: 1 });
    expect(release).toHaveBeenCalledExactlyOnceWith(lease);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'session-navigation-applied',
        agentId,
        workflowRunId: 'navigation-workflow-run',
        navigationRevision: 1,
        sessionId,
      }),
    ]);
  });
});
