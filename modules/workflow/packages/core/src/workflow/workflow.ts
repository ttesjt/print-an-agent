import { randomUUID } from 'node:crypto';
import {
  WorkflowRunError,
  type WorkflowContext,
  type ResolvedStepRegistry,
  type StepExecutor,
} from '../contracts/index.js';
import {
  combineFailures,
  createEventEmitter,
  ExecutionScope,
  StepRuntime,
} from '../execution/index.js';
import { RUN_WORKFLOW } from './condition.js';
import { prepareWorkflowDefinition } from './definition.js';
import { requireSynchronousResult } from './results.js';
import type { WorkflowDefinition } from './types/definition.js';
import type { RunnableWorkflow, WorkflowRunOptions } from './types/run.js';

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
    const prepared = prepareWorkflowDefinition(definition);
    this.name = prepared.name;
    this.#definition = prepared.definition;
    this.#steps = prepared.steps;
    this.#executor = prepared.executor;
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
