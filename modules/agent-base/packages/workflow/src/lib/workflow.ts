import { randomUUID } from 'node:crypto';
import type { AnyAgentContext, BaseWorkflowContext } from '../types/context.js';
import { AgentDefinitionError, AgentRunError } from '../types/errors.js';
import type { ResolvedStepRegistry, StepExecutor, StepName } from '../types/step.js';
import type {
  RunnableWorkflow,
  WorkflowDefinition,
  WorkflowRunOutcome,
} from '../types/workflow.js';
import { RUN_WORKFLOW } from '../workflow-decision.js';
import { defaultStepExecutor } from './default-step-executor.js';
import { resolveStepRegistry } from './step-registry.js';

export class Workflow<
  TStepName extends StepName,
  C extends AnyAgentContext,
  WC extends BaseWorkflowContext<TStepName, C, TResult>,
  TResult,
> implements RunnableWorkflow<C> {
  readonly name: string;

  readonly #entryStep: TStepName;
  readonly #steps: ResolvedStepRegistry<TStepName, WC>;
  readonly #createContext: WorkflowDefinition<TStepName, C, WC, TResult>['createContext'];
  readonly #condition: NonNullable<WorkflowDefinition<TStepName, C, WC, TResult>['condition']>;
  readonly #lifecycle: Readonly<
    NonNullable<WorkflowDefinition<TStepName, C, WC, TResult>['lifecycle']>
  >;
  readonly #applyResult: WorkflowDefinition<TStepName, C, WC, TResult>['applyResult'];
  readonly #executeStep: StepExecutor<TStepName, WC>;
  readonly #createRunId: () => string;

  constructor(definition: WorkflowDefinition<TStepName, C, WC, TResult>) {
    this.name = definition.name;
    this.#entryStep = definition.entryStep;
    this.#steps = resolveStepRegistry(definition.stepDefinitions, definition.stepOverrides);
    this.#createContext = definition.createContext;
    this.#condition = definition.condition ?? (() => Promise.resolve(RUN_WORKFLOW));
    this.#lifecycle = Object.freeze({ ...definition.lifecycle });
    this.#applyResult = definition.applyResult;
    this.#executeStep = definition.executeStep ?? defaultStepExecutor;
    this.#createRunId = definition.createRunId ?? randomUUID;

    const entry = this.#steps[this.#entryStep] as
      | ResolvedStepRegistry<TStepName, WC>[TStepName]
      | undefined;
    if (entry === undefined) {
      throw new AgentDefinitionError(
        'STEP_IMPLEMENTATION_MISSING',
        this.#entryStep,
        `Workflow entry step "${this.#entryStep}" is not registered.`
      );
    }
    if (entry.status === 'skipped') {
      throw new AgentDefinitionError(
        'WORKFLOW_ENTRY_STEP_SKIPPED',
        this.#entryStep,
        `Workflow entry step "${this.#entryStep}" cannot be skipped.`
      );
    }
  }

  async run(agentContext: C): Promise<WorkflowRunOutcome<C, TResult>> {
    const decision = await this.#condition(agentContext);
    if (decision.status === 'skip') {
      return Object.freeze({
        status: 'skipped',
        workflowName: this.name,
        reason: decision.reason,
      });
    }
    if (decision.status !== 'run') {
      throw new AgentRunError(
        'WORKFLOW_CONDITION_INVALID',
        `Workflow "${this.name}" returned an invalid condition decision.`,
        this.name
      );
    }

    const workflowRunId = this.#createRunId();
    const runState: { context?: WC } = {};

    const runStep = async (stepName: TStepName): Promise<void> => {
      const context = runState.context;
      if (context === undefined) {
        throw new AgentRunError(
          'WORKFLOW_CONTEXT_NOT_READY',
          `Step "${stepName}" cannot run before the Workflow Context has been created.`,
          stepName
        );
      }

      const resolved = this.#steps[stepName];
      if (resolved === undefined) {
        throw new AgentRunError(
          'STEP_NOT_REGISTERED',
          `Step "${stepName}" is not registered for workflow "${this.name}".`,
          stepName
        );
      }

      if (resolved.status === 'skipped') return;
      await this.#executeStep({ stepName, step: resolved.step, context });
    };

    const context = this.#createContext({
      workflowName: this.name,
      workflowRunId,
      agentContext,
      signal: agentContext.signal,
      runStep,
    });
    runState.context = context;

    if (context.runStep !== runStep) {
      throw new AgentRunError(
        'WORKFLOW_CONTEXT_RUNNER_REPLACED',
        'Workflow Context factories must preserve the run-scoped runStep function.',
        this.name
      );
    }
    if (
      context.workflowName !== this.name ||
      context.workflowRunId !== workflowRunId ||
      context.agentContext !== agentContext ||
      context.signal !== agentContext.signal
    ) {
      throw new AgentRunError(
        'WORKFLOW_CONTEXT_BASE_REPLACED',
        `Workflow Context factory for "${this.name}" replaced runtime-owned base fields.`,
        this.name
      );
    }

    let result: TResult | undefined;
    let executionError: unknown;
    let executionFailed = false;
    let errorHandlerError: unknown;
    let errorHandlerFailed = false;
    let finallyHandlerError: unknown;
    let finallyHandlerFailed = false;

    try {
      await runStep(this.#entryStep);

      if (!Object.hasOwn(context, 'result')) {
        throw new AgentRunError(
          'WORKFLOW_RESULT_MISSING',
          `Workflow "${this.name}" completed without assigning context.result.`,
          this.name
        );
      }

      result = context.result as TResult;
      await this.#lifecycle.onSuccess?.(context);
    } catch (error) {
      executionFailed = true;
      executionError = error;
      try {
        await this.#lifecycle.onError?.(context, error);
      } catch (handlerError) {
        errorHandlerFailed = true;
        errorHandlerError = handlerError;
      }
    }

    try {
      await this.#lifecycle.onFinally?.(context);
    } catch (handlerError) {
      finallyHandlerFailed = true;
      finallyHandlerError = handlerError;
    }

    if (executionFailed) {
      if (errorHandlerFailed || finallyHandlerFailed) {
        const errors = [executionError];
        if (errorHandlerFailed) errors.push(errorHandlerError);
        if (finallyHandlerFailed) errors.push(finallyHandlerError);
        throw new AggregateError(
          errors,
          `Workflow "${this.name}" failed and one or more lifecycle handlers also failed.`,
          { cause: executionError }
        );
      }
      throw executionError;
    }
    if (finallyHandlerFailed) throw finallyHandlerError;
    const completedResult = result as TResult;

    return Object.freeze({
      status: 'completed',
      workflowName: this.name,
      workflowRunId,
      result: completedResult,
      applyTo: async (targetContext: C) => {
        if (targetContext !== agentContext) {
          throw new AgentRunError(
            'WORKFLOW_RESULT_CONTEXT_MISMATCH',
            `Workflow result from "${this.name}" cannot be applied to a different Agent Context.`,
            this.name
          );
        }
        await this.#applyResult(targetContext, completedResult);
      },
    });
  }
}

export function createWorkflow<
  TStepName extends StepName,
  C extends AnyAgentContext,
  WC extends BaseWorkflowContext<TStepName, C, TResult>,
  TResult,
>(definition: WorkflowDefinition<TStepName, C, WC, TResult>): Workflow<TStepName, C, WC, TResult> {
  return new Workflow(definition);
}
