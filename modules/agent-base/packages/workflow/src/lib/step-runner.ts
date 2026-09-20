import { traceErrorCode, type AgentTraceEmitter } from '@ta-agent/base-observability';
import { STEP_CARDINALITY } from '../step-cardinality.js';
import type { AnyWorkflowContext, StepRunner } from '../types/context.js';
import { AgentRunError } from '../types/errors.js';
import type { ResolvedStepRegistry, StepExecutor, StepName } from '../types/step.js';

interface StepRunnerOptions<TStepName extends StepName, C extends AnyWorkflowContext> {
  readonly workflowName: string;
  readonly workflowRunId: string;
  readonly steps: ResolvedStepRegistry<TStepName, C>;
  readonly getContext: () => C | undefined;
  readonly executeStep: StepExecutor<TStepName, C>;
  readonly traceEmitter: AgentTraceEmitter | undefined;
}

/** A runner belongs to exactly one Workflow Run, never to the reusable Workflow definition. */
export function createStepRunner<TStepName extends StepName, C extends AnyWorkflowContext>(
  options: StepRunnerOptions<TStepName, C>
): StepRunner<TStepName>['runStep'] {
  const invocations = new Map<TStepName, 'running' | 'settled'>();
  return async (stepName) => {
    const context = options.getContext();
    if (context === undefined) {
      throw new AgentRunError(
        'WORKFLOW_CONTEXT_NOT_READY',
        'Step cannot run before the Workflow Context has been created.',
        stepName
      );
    }
    const resolved = options.steps[stepName];
    if (resolved === undefined) {
      throw new AgentRunError(
        'STEP_NOT_REGISTERED',
        `Step "${stepName}" is not registered for workflow "${options.workflowName}".`,
        stepName
      );
    }
    const state = invocations.get(stepName);
    if (state === 'running') {
      throw new AgentRunError(
        'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
        `Step "${stepName}" already has a running invocation.`,
        stepName
      );
    }
    if (state === 'settled' && resolved.cardinality === STEP_CARDINALITY.AT_MOST_ONCE) {
      throw new AgentRunError(
        'STEP_CARDINALITY_EXCEEDED',
        `Step "${stepName}" allows at most one invocation per Workflow Run.`,
        stepName
      );
    }

    // Reserve before any await, including skip/start tracing. Rejected calls have no lifecycle.
    invocations.set(stepName, 'running');
    const reference = {
      workflowName: options.workflowName,
      workflowRunId: options.workflowRunId,
      stepName,
    };
    try {
      if (resolved.status === 'skipped') {
        await options.traceEmitter?.record({ type: 'step-skipped', ...reference });
        return;
      }
      await options.traceEmitter?.record({ type: 'step-started', ...reference });
      try {
        // An executor may attempt the implementation more than once within this invocation.
        await options.executeStep({ stepName, step: resolved.step, context });
      } catch (error: unknown) {
        await options.traceEmitter?.record({
          type: 'step-failed',
          ...reference,
          errorCode: traceErrorCode(error),
        });
        throw error;
      }
      await options.traceEmitter?.record({ type: 'step-completed', ...reference });
    } finally {
      // Retain cardinality history, but release the running state even if tracing throws.
      invocations.set(stepName, 'settled');
    }
  };
}
