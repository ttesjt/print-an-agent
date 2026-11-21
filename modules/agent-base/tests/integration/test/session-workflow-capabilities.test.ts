import {
  createAgentActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
} from '@print-an-agent/agent-actor';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import {
  createDefaultSessionCompactionStepOverrides,
  createDefaultSessionNavigationStepOverrides,
  createSessionCompactionWorkflow,
  createSessionNavigationWorkflow,
  DEFAULT_SESSION_BRANCH_ID,
  DEFAULT_SESSION_COMPACTION_POLICY,
  parseSessionId,
  parseTurnId,
  type CreateSessionCompactionWorkflowOptions,
  type CreateSessionNavigationWorkflowOptions,
  type CompactableSessionPort,
  type NavigableCompactableSessionPort,
  type SessionCompactionResources,
  type SessionCompactionWorkflowContext,
  type SessionNavigationCoordinatorPort,
  type SessionNavigationWorkflowContext,
  type SessionSnapshot,
} from '@print-an-agent/base-session';
import { RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { expect, expectTypeOf, it } from 'vitest';

const agentId = parseAgentId('narrow-session-consumer');
const sessionId = parseSessionId('session');
const snapshot: SessionSnapshot = {
  agentId,
  sessionId,
  navigation: {
    agentId,
    sessionId,
    revision: 0,
    selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
    branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 0 }],
  },
  turns: [],
};

it('runs navigation with inspection and navigation capabilities alone', async () => {
  const session: SessionNavigationCoordinatorPort = {
    inspect: () => Promise.resolve(snapshot),
    applyNavigation: () => Promise.reject(new Error('Inspection must not mutate navigation.')),
  };
  const resources = { session };
  const workflow = createSessionNavigationWorkflow({
    resources,
    stepOverrides: createDefaultSessionNavigationStepOverrides<typeof resources>(),
  });
  await expect(
    workflow.run({ input: { agentId, navigation: { sessionId, operation: 'inspect' } } })
  ).resolves.toMatchObject({ status: 'inspected', navigation: snapshot.navigation });
});

it('checks compaction eligibility without requiring turn-runtime methods or model invocation', async () => {
  const session: Pick<CompactableSessionPort, 'inspect' | 'readCompaction' | 'commitCompaction'> = {
    inspect: () => Promise.resolve(snapshot),
    readCompaction: () => Promise.resolve(undefined),
    commitCompaction: () => Promise.reject(new Error('Ineligible source must not be published.')),
  };
  const resources = compactionResources(session);
  const workflow = createSessionCompactionWorkflow({
    resources,
    stepOverrides: createDefaultSessionCompactionStepOverrides<typeof resources>(),
  });
  await expect(
    workflow.run({ input: { agentId, compactionInput: { sessionId } } })
  ).resolves.toMatchObject({ status: 'skipped', reason: 'not-needed' });
  expectTypeOf<CompactableSessionPort>().toExtend<SessionCompactionResources['session']>();
  expectTypeOf<NavigableCompactableSessionPort>().toExtend<SessionNavigationCoordinatorPort>();
});

async function createHistoryFixture() {
  const session = new MemorySessionAdapter();
  const reference = await session.resolve({ agentId });
  const turnId = parseTurnId('history-boundary');
  const execution = await session.acquireSessionExecution(reference);
  try {
    await session.beginTurn({
      ...reference,
      execution,
      turnId,
      userMessage: { role: 'user', text: 'History boundary', timestamp: 0 },
    });
    await session.failTurn({ ...reference, execution, turnId, failureCode: 'TEST_BOUNDARY' });
  } finally {
    await session.releaseSessionExecution(execution);
  }
  return { session, historyInput: { ...reference, beforeTurnId: turnId } };
}

function compactionResources<
  S extends Pick<CompactableSessionPort, 'inspect' | 'readCompaction' | 'commitCompaction'>,
>(session: S): SessionCompactionResources<S> {
  return {
    session,
    responsibilities: createResponsibilityRouter({
      actorCatalog: createAgentActorCatalog({ actors: [], engines: [] }),
      responsibilityCatalog: createResponsibilityCatalog({ responsibilities: [] }),
    }),
    instructions: 'Compact.',
    policy: DEFAULT_SESSION_COMPACTION_POLICY,
    clock: () => 0,
  };
}

it('preserves history access in legacy compaction Contexts, options and default overrides', async () => {
  const { session, historyInput } = await createHistoryFixture();
  const historyReads: unknown[] = [];
  const overrides: ReturnType<typeof createDefaultSessionCompactionStepOverrides> = {
    ...createDefaultSessionCompactionStepOverrides(),
    async runSessionCompaction(context: SessionCompactionWorkflowContext) {
      historyReads.push(await context.resources.session.loadHistory(historyInput));
      context.state.outcome = {
        status: 'skipped',
        sessionId: historyInput.sessionId,
        branchId: DEFAULT_SESSION_BRANCH_ID,
        reason: 'not-needed',
      };
    },
  };
  const options: CreateSessionCompactionWorkflowOptions = {
    resources: compactionResources(session),
    stepOverrides: overrides,
    condition: async ({ resources }) => {
      historyReads.push(await resources.session.loadHistory(historyInput));
      return RUN_WORKFLOW;
    },
    executeStep: async ({ context, step }) => {
      expect(await context.resources.session.loadHistory(historyInput)).toEqual([]);
      await step(context);
    },
  };
  await expect(
    createSessionCompactionWorkflow({
      ...options,
      resources: { ...options.resources, session },
    }).run({
      input: { agentId, compactionInput: { sessionId: historyInput.sessionId } },
    })
  ).resolves.toMatchObject({ status: 'skipped' });
  expect(historyReads).toEqual([[], []]);
});

it('preserves history access in legacy navigation Contexts, options and default overrides', async () => {
  const { session, historyInput } = await createHistoryFixture();
  const historyReads: unknown[] = [];
  const overrides: ReturnType<typeof createDefaultSessionNavigationStepOverrides> = {
    ...createDefaultSessionNavigationStepOverrides(),
    async inspectSessionNavigation(context: SessionNavigationWorkflowContext) {
      historyReads.push(await context.resources.session.loadHistory(historyInput));
      const snapshot = await context.resources.session.inspect(historyInput);
      if (snapshot === undefined) throw new Error('Expected the existing Session.');
      context.state.outcome = { status: 'inspected', navigation: snapshot.navigation };
    },
  };
  const options: CreateSessionNavigationWorkflowOptions = {
    resources: { session },
    stepOverrides: overrides,
    executeStep: async ({ context, step }) => {
      expect(await context.resources.session.loadHistory(historyInput)).toEqual([]);
      await step(context);
    },
  };
  await expect(
    createSessionNavigationWorkflow({ ...options, resources: { session } }).run({
      input: { agentId, navigation: { sessionId: historyInput.sessionId, operation: 'inspect' } },
    })
  ).resolves.toMatchObject({ status: 'inspected' });
  expect(historyReads).toEqual([[]]);
});

it('preserves inferred compaction resources in overrides, conditions, executors and lifecycle hooks', async () => {
  const { session, historyInput } = await createHistoryFixture();
  const phases: string[] = [];
  const resources = {
    ...compactionResources(session),
    recordPhase: (phase: string): void => {
      phases.push(phase);
    },
  };
  const workflow = createSessionCompactionWorkflow({
    resources,
    condition: ({ resources }) => {
      resources.recordPhase('condition');
      return RUN_WORKFLOW;
    },
    stepOverrides: {
      async runSessionCompaction(context) {
        context.resources.recordPhase('step');
        expect(await context.resources.session.loadHistory(historyInput)).toEqual([]);
        context.state.outcome = {
          status: 'skipped',
          sessionId: historyInput.sessionId,
          branchId: DEFAULT_SESSION_BRANCH_ID,
          reason: 'not-needed',
        };
      },
    },
    executeStep: async ({ context, step }) => {
      context.resources.recordPhase('executor');
      await step(context);
    },
    lifecycle: {
      onFinally: ({ resources }) => {
        resources.recordPhase('finally');
      },
    },
  });
  await workflow.run({
    input: { agentId, compactionInput: { sessionId: historyInput.sessionId } },
  });
  expect(phases).toEqual(['condition', 'executor', 'step', 'finally']);
});

it('preserves inferred navigation resources in overrides, conditions, executors and lifecycle hooks', async () => {
  const { session, historyInput } = await createHistoryFixture();
  const phases: string[] = [];
  const resources = {
    session,
    recordPhase: (phase: string): void => {
      phases.push(phase);
    },
  };
  const workflow = createSessionNavigationWorkflow({
    resources,
    condition: ({ resources }) => {
      resources.recordPhase('condition');
      return RUN_WORKFLOW;
    },
    stepOverrides: {
      async runSessionNavigation(context) {
        context.resources.recordPhase('step');
        expect(await context.resources.session.loadHistory(historyInput)).toEqual([]);
        const snapshot = await context.resources.session.inspect(historyInput);
        if (snapshot === undefined) throw new Error('Expected the existing Session.');
        context.state.outcome = { status: 'inspected', navigation: snapshot.navigation };
      },
    },
    executeStep: async ({ context, step }) => {
      context.resources.recordPhase('executor');
      await step(context);
    },
    lifecycle: {
      onFinally: ({ resources }) => {
        resources.recordPhase('finally');
      },
    },
  });
  await workflow.run({
    input: { agentId, navigation: { sessionId: historyInput.sessionId, operation: 'inspect' } },
  });
  expect(phases).toEqual(['condition', 'executor', 'step', 'finally']);
});
