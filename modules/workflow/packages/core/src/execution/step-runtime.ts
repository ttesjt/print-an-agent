import { WorkflowRunError } from '../errors.js';
import type { WorkflowContext } from '../types/context.js';
import type { WorkflowEventReference } from '../types/events.js';
import { STEP_CARDINALITY, type ResolvedStepRegistry, type StepExecutor } from '../types/step.js';
import { createContext, type RunData } from './context.js';
import { executeInvocation } from './executor.js';
import type { WorkflowEventEmitter } from './observer.js';
import { runParallel } from './parallel.js';
import { ExecutionScope } from './scope.js';
import { runInScope } from './run-in-scope.js';

export class StepRuntime<N extends string, S, R> {
  readonly #invocations = new Map<N, 'running' | 'settled'>();
  readonly #protocolFailures: unknown[] = [];
  #sequence = 0;

  constructor(
    readonly options: {
      data: RunData<S, R>;
      reference: WorkflowEventReference;
      root: ExecutionScope;
      steps: ResolvedStepRegistry<N, WorkflowContext<N, S, R>>;
      executor: StepExecutor<N, WorkflowContext<N, S, R>>;
      events: WorkflowEventEmitter;
    }
  ) {}

  context(scope = this.options.root): WorkflowContext<N, S, R> {
    return createContext(
      this.options.data,
      this.options.reference,
      scope,
      (name) => this.runStep(scope, name),
      (names) =>
        this.#admit(() => {
          this.options.root.assertAdmission();
          scope.assertAdmission();
          const snapshot = [...names];
          return scope.track(() =>
            runParallel(scope, snapshot, (group, name) => this.runStep(group, name))
          );
        })
    );
  }

  runStep(parent: ExecutionScope, name: N): Promise<void> {
    return this.#admit(() => {
      this.options.root.assertAdmission();
      parent.assertAdmission();
      const resolved = this.options.steps[name];
      if (resolved === undefined)
        throw new WorkflowRunError('STEP_NOT_REGISTERED', `Unknown Step: ${name}`, name);
      const state = this.#invocations.get(name);
      if (state === 'running')
        throw new WorkflowRunError(
          'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED',
          `Step already running: ${name}`,
          name
        );
      if (state === 'settled' && resolved.cardinality === STEP_CARDINALITY.AT_MOST_ONCE) {
        throw new WorkflowRunError(
          'STEP_CARDINALITY_EXCEEDED',
          `Step already invoked: ${name}`,
          name
        );
      }
      this.#invocations.set(name, 'running');
      const scope = new ExecutionScope(parent.signal);
      const invocationId = `${this.options.reference.workflowRunId}:${++this.#sequence}`;
      return parent.track(async () => {
        try {
          scope.signal.throwIfAborted();
          const reference = { ...this.options.reference, stepName: name, invocationId };
          if (resolved.status === 'skipped') {
            this.options.events.emit({ type: 'step-skipped', ...reference });
            return;
          }
          this.options.events.emit({ type: 'step-started', ...reference });
          try {
            const incomplete = () =>
              this.#violate(
                'WORKFLOW_EXECUTION_INCOMPLETE',
                `Step returned before its children: ${name}`,
                name
              );
            await runInScope(
              scope,
              () =>
                executeInvocation({
                  name,
                  scope,
                  context: this.context(scope),
                  step: resolved.step,
                  executor: this.options.executor,
                  createContext: (attempt) => this.context(attempt),
                  incomplete,
                  violate: (message) => this.#violate('STEP_EXECUTOR_INVALID', message, name),
                }),
              incomplete
            );
          } catch (error) {
            this.options.events.fail({ type: 'step-failed', ...reference }, error);
            throw error;
          }
          this.options.events.emit({ type: 'step-completed', ...reference });
        } finally {
          scope.close();
          this.#invocations.set(name, 'settled');
        }
      });
    });
  }

  async finish(): Promise<unknown[]> {
    this.options.root.close();
    const failures = await this.options.root.drain();
    return [...this.#protocolFailures, ...failures];
  }

  get protocolFailures(): readonly unknown[] {
    return [...this.#protocolFailures];
  }

  #violate(
    code: 'STEP_EXECUTOR_INVALID' | 'WORKFLOW_EXECUTION_INCOMPLETE',
    message: string,
    name: N
  ): Error {
    const error = new WorkflowRunError(code, message, name);
    this.#protocolFailures.push(error);
    this.options.root.close();
    this.options.root.cancel(error);
    return error;
  }

  #admit(work: () => Promise<void>): Promise<void> {
    try {
      return work();
    } catch (error) {
      const rejected = Promise.resolve().then(() => {
        throw error;
      });
      void rejected.catch(() => undefined);
      return rejected;
    }
  }
}
