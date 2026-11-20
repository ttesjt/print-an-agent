import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  DEFAULT_SESSION_COMPACTION_POLICY,
  type SessionCompactionResources,
  type SessionCompactionState,
  type SessionCompactionWorkflowInput,
} from '../../../src/index.js';
import {
  createRunnableCompaction,
  createTestResponsibilities,
  createTwoTurnSnapshot,
  rejectWhenAborted,
} from '../../support/compaction/workflow-fixtures.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

afterEach(() => {
  vi.useRealTimers();
});
describe('Session compaction Workflow contracts', () => {
  it('selects only declared business input and never retains execution context extras', async () => {
    const identity = defineAgentIdentity({ id: 'narrow-compaction' });
    let state: SessionCompactionState | undefined;
    const workflow = createSessionCompactionWorkflow({
      resources: {
        session: createSessionPortStub(),
        responsibilities: createTestResponsibilities(),
        instructions: 'Compact.',
        policy: DEFAULT_SESSION_COMPACTION_POLICY,
        clock: () => 1,
      },
      stepOverrides: {
        runSessionCompaction: (context) => {
          state = context.state;
          context.state.outcome = {
            status: 'skipped',
            sessionId: 'session',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            reason: 'not-needed',
          };
          return Promise.resolve();
        },
      },
    });
    const input = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session' }),
      signal: new AbortController().signal,
      operations: { invoke: () => Promise.reject(new Error('Not a Workflow capability.')) },
      output: 'not a Workflow result',
    };
    await expect(workflow.run({ input })).resolves.toMatchObject({ status: 'skipped' });
    expect(state).not.toBe(input);
    expect(state).toMatchObject({ agentId: input.agentId, compactionInput: input.compactionInput });
    for (const key of ['agentRun', 'signal', 'operations', 'output', 'traceEmitter']) {
      expect(state).not.toHaveProperty(key);
    }
    expectTypeOf<SessionCompactionState>().not.toHaveProperty('agentRun');
    expectTypeOf<SessionCompactionState>().not.toHaveProperty('signal');
    expect(input).not.toHaveProperty('outcome');
  });

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
    const input: SessionCompactionWorkflowInput = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
    };

    await expect(workflow.run({ input })).rejects.toMatchObject({
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
    const input: SessionCompactionWorkflowInput = {
      agentId: identity.id,
      compactionInput: Object.freeze({ sessionId: 'session', branchId: DEFAULT_SESSION_BRANCH_ID }),
    };

    await expect(workflow.run({ input })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'not-needed',
    });
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

    const run = fixture.workflow.run({
      input: fixture.input,
      signal: fixture.signal,
    });
    const expectation = expect(run).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10);

    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });
});
