import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { expect, it, vi } from 'vitest';
import {
  createDefaultSessionNavigationStepOverrides,
  createSessionNavigationWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionExecutionId,
  parseSessionId,
  type SessionNavigationOutcome,
  type SessionNavigationWorkflowContext,
  type SessionSnapshot,
} from '../../../src/index.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

it.each(['validateSessionNavigation', 'inspectSessionNavigation'] as const)(
  'preserves the result supplied by %s without applying navigation',
  async (stepName) => {
    const agentId = parseAgentId('navigation-result-agent');
    const sessionId = parseSessionId('session');
    const snapshot: SessionSnapshot = {
      agentId,
      sessionId,
      navigation: {
        agentId,
        sessionId,
        revision: 0,
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }],
      },
      turns: [],
    };
    const result: SessionNavigationOutcome = {
      status: 'inspected',
      navigation: snapshot.navigation,
    };
    const lease = { agentId, sessionId, executionId: parseSessionExecutionId('execution') };
    const release = vi.fn(() => Promise.resolve());
    const applyNavigation = vi.fn(() =>
      Promise.resolve({
        operation: 'select' as const,
        affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        navigation: { ...snapshot.navigation, revision: 1 },
      })
    );
    const session = {
      ...createSessionPortStub({
        inspect: () => Promise.resolve(snapshot),
        applyNavigation,
      }),
      acquireSessionExecution: () => Promise.resolve(lease),
      releaseSessionExecution: release,
    };
    const defaults = createDefaultSessionNavigationStepOverrides();
    const originalStep = defaults[stepName];
    if (typeof originalStep !== 'function') throw new Error('Expected a default navigation Step.');
    const workflow = createSessionNavigationWorkflow({
      resources: { session },
      stepOverrides: {
        ...defaults,
        [stepName]: async (context: SessionNavigationWorkflowContext) => {
          await originalStep(context);
          context.state.outcome = result;
        },
      },
    });

    await expect(
      workflow.run({
        input: {
          agentId,
          navigation: {
            sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 0,
          },
        },
      })
    ).resolves.toBe(result);
    expect(applyNavigation).not.toHaveBeenCalled();
    if (stepName === 'inspectSessionNavigation') {
      expect(release).toHaveBeenCalledExactlyOnceWith(lease);
    } else {
      expect(release).not.toHaveBeenCalled();
    }
  }
);
