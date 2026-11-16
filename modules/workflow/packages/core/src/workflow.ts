import { randomUUID } from 'node:crypto';
import { isPromise } from 'node:util/types';
import { WorkflowDefinitionError, WorkflowRunError } from './errors.js';
import { combineFailures } from './execution/failures.js';
import { createEventEmitter } from './execution/observer.js';
import { ExecutionScope } from './execution/scope.js';
import { StepRuntime } from './execution/step-runtime.js';
import { resolveStepRegistry } from './registry/step-registry.js';
import type { WorkflowContext } from './types/context.js';
import type { ResolvedStepRegistry, StepExecutor } from './types/step.js';
import {
  RUN_WORKFLOW,
  type RunnableWorkflow,
  type WorkflowDefinition,
  type WorkflowRunOptions,
} from './types/workflow.js';

function requireSynchronousResult<T>(
  result: T,
  factory: 'createResult' | 'createSkippedResult'
): T {
  if (isPromise(result)) {
    // Observe rejection now, including across realms and while lifecycle cleanup is pending.
    void Promise.prototype.then.call(
      result,
      () => undefined,
      () => undefined
    );
  } else if (
    !((typeof result === 'object' && result !== null) || typeof result === 'function') ||
    typeof Reflect.get(result, 'then') !== 'function'
  ) {
    return result;
  }
  throw new WorkflowRunError(
    'WORKFLOW_RESULT_ASYNC',
    `${factory} must return a synchronous result.`,
    factory
  );
}

export class Workflow<
  TStepName extends string,
  TInput,
  TState,
  TResources,
  TResult,
> implements RunnableWorkflow<TInput, TResult> {
  readonly name: string;
  readonly #definition: WorkflowDefinition<TStepName, TInput, TState, TResources, TResult>;
  readonly #steps: ResolvedStepRegistry<TStepName, WorkflowContext<TStepName, TState, TResources>>;
  readonly #executor: StepExecutor<TStepName, WorkflowContext<TStepName, TState, TResources>>;

  constructor(definition: WorkflowDefinition<TStepName, TInput, TState, TResources, TResult>) {
    if (typeof definition.name !== 'string' || definition.name.trim() === '') {
      throw new WorkflowDefinitionError(
        'WORKFLOW_NAME_INVALID',
        definition.name,
        'Workflow name is required.'
      );
    }
    this.name = definition.name;
    this.#definition = Object.freeze({
      ...definition,
      lifecycle: Object.freeze({ ...definition.lifecycle }),
    });
    const { createResult, createSkippedResult } = this.#definition;
    if (
      typeof createResult !== 'function' ||
      (createSkippedResult !== undefined && typeof createSkippedResult !== 'function')
    )
      throw new WorkflowDefinitionError(
        'WORKFLOW_RESULT_FACTORY_INVALID',
        this.name,
        'Workflow requires a callable createResult and, when supplied, a callable createSkippedResult.'
      );
    this.#steps = resolveStepRegistry(definition.stepDefinitions, definition.stepOverrides);
    this.#executor = definition.executeStep ?? (async ({ step, context }) => step(context));
    const entry = this.#steps[definition.entryStep];
    if (entry === undefined)
      throw new WorkflowDefinitionError(
        'STEP_IMPLEMENTATION_MISSING',
        definition.entryStep,
        'Entry Step is not registered.'
      );
    if (entry.status === 'skipped')
      throw new WorkflowDefinitionError(
        'WORKFLOW_ENTRY_STEP_SKIPPED',
        definition.entryStep,
        'Entry Step cannot be skipped.'
      );
  }

  async run(options: WorkflowRunOptions<TInput>): Promise<TResult> {
    const definition = this.#definition;
    const reference = Object.freeze({
      workflowName: this.name,
      workflowRunId: (definition.createRunId ?? randomUUID)(),
      parentRunId: options.parentRunId,
    });
    const events = createEventEmitter(options.onEvent, options.classifyFailure);
    const { emit } = events;
    const root = new ExecutionScope(options.signal ?? new AbortController().signal);
    emit({ type: 'workflow-started', ...reference });
    try {
      root.assertAdmission();
      const inputs = Object.freeze({ input: options.input, resources: definition.resources });
      const decision = await (definition.condition?.({ ...inputs, signal: root.signal }) ??
        RUN_WORKFLOW);
      root.assertAdmission();
      if (decision.status === 'skip') {
        if (definition.createSkippedResult === undefined)
          throw new WorkflowRunError(
            'WORKFLOW_SKIP_RESULT_MISSING',
            'A skipping Workflow requires createSkippedResult.'
          );
        const { reason } = decision;
        const result = requireSynchronousResult(
          definition.createSkippedResult({ input: inputs.input, reason }),
          'createSkippedResult'
        );
        emit({ type: 'workflow-skipped', ...reference, reason });
        return result;
      }
      if (decision.status !== 'run')
        throw new WorkflowRunError('WORKFLOW_CONDITION_INVALID', 'Invalid Workflow condition.');
      const data = {
        resources: definition.resources,
        state: definition.createState(inputs),
      };
      const runtime = new StepRuntime({
        data,
        reference,
        root,
        steps: this.#steps,
        executor: this.#executor,
        events,
      });
      const context = runtime.context();
      let failures: unknown[] = [];
      try {
        await runtime.runStep(root, definition.entryStep);
      } catch (error) {
        failures.push(error);
      }
      failures = [...(await runtime.finish()), ...failures];
      const lifecycle = definition.lifecycle;
      if (failures.length === 0) {
        try {
          await lifecycle?.onSuccess?.(context);
        } catch (error) {
          failures.push(error);
        }
      }
      // A hook can encounter a retained guarded callable. Catching its rejection must not
      // erase a protocol violation that occurred before this run's terminal outcome.
      failures.push(...runtime.protocolFailures);
      let projected: { value: TResult } | undefined;
      if (failures.length === 0) {
        try {
          projected = {
            value: requireSynchronousResult(definition.createResult(data.state), 'createResult'),
          };
        } catch (error) {
          failures.push(error);
        }
        failures.push(...runtime.protocolFailures);
      }
      if (failures.length !== 0) {
        try {
          await lifecycle?.onError?.(context, combineFailures(failures));
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await lifecycle?.onFinally?.(context);
      } catch (error) {
        failures.push(error);
      }
      failures.push(...runtime.protocolFailures);
      if (projected === undefined || failures.length !== 0) throw combineFailures(failures);
      emit({ type: 'workflow-completed', ...reference });
      return projected.value;
    } catch (error) {
      events.fail({ type: 'workflow-failed', ...reference }, error);
      throw error;
    } finally {
      root.close();
    }
  }
}
