import { parseAgentId } from '@print-an-agent/base-identity';
import { createAgentTraceEmitter, type AgentTraceEvent } from '@print-an-agent/base-observability';
import { expect, it, vi } from 'vitest';
import {
  createDefaultSessionNavigationStepOverrides,
  createSessionNavigationWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';

it('reuses its bound Session port without retaining a preceding navigation trace emitter', async () => {
  const agentId = parseAgentId('navigation-binding');
  const sessionId = parseSessionId('session');
  let revision = 0;
  const navigation = () => ({
    agentId,
    sessionId,
    revision,
    selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
    branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }],
  });
  const inspect = vi.fn(() =>
    Promise.resolve({ agentId, sessionId, navigation: navigation(), turns: [] })
  );
  const applyNavigation = vi.fn(() => {
    revision++;
    return Promise.resolve({
      operation: 'select' as const,
      affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      navigation: navigation(),
    });
  });
  const session = createSessionPortStub({ inspect, applyNavigation });
  let nextRun = 0;
  const workflow = createSessionNavigationWorkflow({
    resources: { session },
    stepOverrides: createDefaultSessionNavigationStepOverrides(),
    createRunId: () => `navigation-${++nextRun}`,
  });
  const first: AgentTraceEvent[] = [];
  const second: AgentTraceEvent[] = [];
  const trace = (agentRunId: string, events: AgentTraceEvent[]) =>
    createAgentTraceEmitter({
      agentId,
      agentRunId,
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    });
  const emitters = [trace('first', first), trace('second', second), undefined];
  for (const [index, traceEmitter] of emitters.entries()) {
    await expect(
      workflow.run({
        input: {
          agentId,
          navigation: {
            operation: 'select',
            sessionId,
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: index,
          },
          ...(traceEmitter === undefined ? {} : { traceEmitter }),
        },
      })
    ).resolves.toMatchObject({ status: 'selected', revision: index + 1 });
  }
  expect(inspect).toHaveBeenCalledTimes(3);
  expect(applyNavigation).toHaveBeenCalledTimes(3);
  expect(first).toEqual([
    expect.objectContaining({
      type: 'session-navigation-applied',
      agentRunId: 'first',
      workflowRunId: 'navigation-1',
      navigationRevision: 1,
    }),
  ]);
  expect(second).toEqual([
    expect.objectContaining({
      type: 'session-navigation-applied',
      agentRunId: 'second',
      workflowRunId: 'navigation-2',
      navigationRevision: 2,
    }),
  ]);
});
