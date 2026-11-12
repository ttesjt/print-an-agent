import type { WorkflowContext } from '@print-an-agent/workflow-core';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { type BaseAgentRunContext } from '@print-an-agent/base-runtime';
import {
  SKIP_STEP,
  STEP_CARDINALITY,
  type Step,
  type StepOverrides,
} from '@print-an-agent/workflow-core';
import { describe, expect, it } from 'vitest';
import {
  createRequestStepDefinitions,
  createRequestWorkflow,
  REQUEST_STEP_NAMES,
  requireInteractionEvent,
  RequestStepNotImplementedError,
  type RequestLeafStepName,
  type RequestStepName,
  type RequestWorkflowStateView,
} from '../../src/index.js';

interface TestAgentContext extends BaseAgentRunContext<string, string> {
  readonly applied: string[];
}

interface TestState extends RequestWorkflowStateView {
  readonly calls: string[];
}
type TestRequestContext = WorkflowContext<
  RequestStepName,
  TestAgentContext,
  TestState,
  undefined,
  string | undefined
>;

const LEAF_STEP_NAMES = REQUEST_STEP_NAMES.filter(
  (stepName): stepName is RequestLeafStepName =>
    stepName !== 'runRequest' &&
    stepName !== 'prepareRequest' &&
    stepName !== 'executeRequest' &&
    stepName !== 'runAgentInteraction' &&
    stepName !== 'dispatchInteractionEvent'
);

const SEQUENTIAL_LEAF_STEP_NAMES = LEAF_STEP_NAMES.filter(
  (name) =>
    name !== 'deliverTextDelta' &&
    name !== 'deliverReasoningDelta' &&
    name !== 'captureReasoningPresentation' &&
    name !== 'buildTurnPresentation' &&
    name !== 'completeAssistantMessage'
);

function agentRunContext(): TestAgentContext {
  return {
    identity: defineAgentIdentity({ id: 'request-test' }),
    operationName: 'request-test',
    runId: 'agent-run',
    input: 'hello',
    signal: new AbortController().signal,
    operations: Object.freeze({
      invoke: () => Promise.reject(new Error('No callable Agent Operations.')),
    }),
    applied: [],
  };
}

function implementedLeafSteps(): StepOverrides<RequestStepName, TestRequestContext> {
  return Object.fromEntries(
    LEAF_STEP_NAMES.map((stepName) => {
      const step: Step<TestRequestContext> = (context) => {
        context.state.calls.push(stepName);
        if (stepName === 'completeResponse') context.result = context.state.calls.join('|');
        return Promise.resolve();
      };
      return [stepName, step];
    })
  );
}

function workflow(stepOverrides: StepOverrides<RequestStepName, TestRequestContext> = {}) {
  return createRequestWorkflow<TestAgentContext, TestState, undefined, string>({
    resources: undefined,
    stepOverrides,
    createState: () => ({ calls: [] }),
    createRunId: () => 'request-run',
  });
}

describe('Request Workflow skeleton', () => {
  it('publishes the canonical ordered Step catalog', () => {
    expect(REQUEST_STEP_NAMES).toEqual([
      'runRequest',
      'prepareRequest',
      'validateRequest',
      'resolveSession',
      'resolveRequestReplay',
      'beginRequest',
      'resolveExecutionTarget',
      'resolveInstructions',
      'loadSessionContext',
      'gatherExternalContext',
      'loadContextMemory',
      'buildTools',
      'buildModelContext',
      'executeRequest',
      'runAgentInteraction',
      'openResponseStream',
      'invokeActorInteraction',
      'dispatchInteractionEvent',
      'deliverTextDelta',
      'deliverReasoningDelta',
      'captureReasoningPresentation',
      'buildTurnPresentation',
      'completeAssistantMessage',
      'buildAgentResponse',
      'completeResponse',
    ]);
  });

  it('fails explicitly at the first unresolved leaf Step', async () => {
    const calls: string[] = [];
    const requestWorkflow = createRequestWorkflow<TestAgentContext, TestState, undefined, string>({
      resources: undefined,
      createState: () => ({ calls: [] }),
      lifecycle: {
        onError: (_context, error) => {
          calls.push(`error:${(error as RequestStepNotImplementedError).stepName}`);
          return Promise.resolve();
        },
        onFinally: () => {
          calls.push('finally');
          return Promise.resolve();
        },
      },
    });

    const error = await requestWorkflow
      .run({ input: agentRunContext() })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RequestStepNotImplementedError);
    expect(error).toMatchObject({
      code: 'REQUEST_STEP_NOT_IMPLEMENTED',
      stepName: 'validateRequest',
    });
    expect(calls).toEqual(['error:validateRequest', 'finally']);
  });

  it('declares repeatable event Steps and accepts a minimum event Context', () => {
    const definitions = createRequestStepDefinitions<TestRequestContext>();
    for (const name of REQUEST_STEP_NAMES) {
      expect(definitions[name].cardinality).toBe(
        name === 'dispatchInteractionEvent' ||
          name === 'deliverTextDelta' ||
          name === 'deliverReasoningDelta' ||
          name === 'captureReasoningPresentation'
          ? STEP_CARDINALITY.REPEATABLE
          : STEP_CARDINALITY.AT_MOST_ONCE
      );
    }
    expect(
      requireInteractionEvent(
        { state: { interaction: { currentEvent: { type: 'text-delta', delta: 'hello' } } } },
        'text-delta'
      ).delta
    ).toBe('hello');
  });

  it('replaces the whole interaction Composite without running its installed children', async () => {
    const requestWorkflow = workflow({
      ...implementedLeafSteps(),
      prepareRequest: () => Promise.resolve(),
      runAgentInteraction: (context) => {
        context.state.calls.push('customInteraction');
        return Promise.resolve();
      },
    });
    await expect(requestWorkflow.run({ input: agentRunContext() })).resolves.toEqual(
      'customInteraction|completeResponse'
    );
  });

  it('executes fully implemented leaf Steps in canonical order', async () => {
    const requestWorkflow = workflow(implementedLeafSteps());
    const context = agentRunContext();

    const outcome = await requestWorkflow.run({ input: context });

    expect(outcome).toEqual(SEQUENTIAL_LEAF_STEP_NAMES.join('|'));
  });

  it('propagates a composite override without invoking captured defaults', async () => {
    const overrides = implementedLeafSteps();
    const requestWorkflow = workflow({
      ...overrides,
      prepareRequest: (context) => {
        context.state.calls.push('customPrepare');
        return Promise.resolve();
      },
    });

    await expect(requestWorkflow.run({ input: agentRunContext() })).resolves.toEqual(
      'customPrepare|openResponseStream|invokeActorInteraction|buildAgentResponse|completeResponse'
    );
  });

  it('short-circuits preparation and execution when replay assigns the result', async () => {
    const overrides = implementedLeafSteps();
    const requestWorkflow = workflow({
      ...overrides,
      resolveRequestReplay: (context) => {
        context.state.calls.push('resolveRequestReplay');
        context.result = 'replayed';
        return Promise.resolve();
      },
    });

    await expect(requestWorkflow.run({ input: agentRunContext() })).resolves.toEqual('replayed');
  });

  it('allows only explicitly optional leaf Steps to be skipped', async () => {
    const definitions = createRequestStepDefinitions<TestRequestContext>();

    expect(definitions.resolveRequestReplay.skippable).toBe(true);
    expect(definitions.gatherExternalContext.skippable).toBe(true);
    expect(definitions.deliverReasoningDelta.skippable).toBe(true);
    expect(definitions.captureReasoningPresentation.skippable).toBe(true);
    expect(definitions.buildTurnPresentation.skippable).toBe(true);
    for (const stepName of REQUEST_STEP_NAMES) {
      if (
        stepName === 'resolveRequestReplay' ||
        stepName === 'gatherExternalContext' ||
        stepName === 'loadContextMemory' ||
        stepName === 'deliverReasoningDelta' ||
        stepName === 'captureReasoningPresentation' ||
        stepName === 'buildTurnPresentation'
      )
        continue;
      expect(definitions[stepName].skippable).toBe(false);
    }

    const requestWorkflow = workflow({
      ...implementedLeafSteps(),
      resolveRequestReplay: SKIP_STEP,
      gatherExternalContext: SKIP_STEP,
    });
    await expect(requestWorkflow.run({ input: agentRunContext() })).resolves.toEqual(
      expect.any(String)
    );
  });

  it('rejects skipping a required request Step during Workflow creation', () => {
    expect(() => workflow({ ...implementedLeafSteps(), validateRequest: SKIP_STEP })).toThrowError(
      /cannot be skipped/u
    );
  });
});
