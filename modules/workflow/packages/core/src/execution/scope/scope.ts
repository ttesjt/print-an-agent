import { WorkflowRunError } from '../../contracts/index.js';
import { composeExecutionSignal } from '../../cancellation/index.js';

type Settlement = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
interface Task {
  readonly settled: Promise<Settlement>;
}

/** A join boundary, not a resource owner. Every tracked promise gets a rejection observer. */
export class ExecutionScope {
  readonly #controller = new AbortController();
  readonly #pending = new Set<Task>();
  #open = true;
  readonly signal: AbortSignal;

  constructor(parentSignal: AbortSignal) {
    this.signal = composeExecutionSignal([parentSignal, this.#controller.signal]);
  }

  get pending(): boolean {
    return this.#pending.size !== 0;
  }
  get open(): boolean {
    return this.#open;
  }

  assertAdmission(): void {
    if (!this.#open)
      throw new WorkflowRunError('WORKFLOW_SCOPE_CLOSED', 'Execution scope is closed.');
    this.signal.throwIfAborted();
  }

  close(): void {
    this.#open = false;
  }
  cancel(reason: unknown): void {
    this.#controller.abort(reason);
  }

  track(work: () => Promise<void>): Promise<void> {
    // Defer the body until after registration, including synchronous user failures.
    const task: Task = {
      settled: Promise.resolve()
        .then(work)
        .then(
          () => {
            this.#pending.delete(task);
            return { status: 'fulfilled' };
          },
          (reason: unknown) => {
            this.#pending.delete(task);
            return { status: 'rejected', reason };
          }
        ),
    };
    this.#pending.add(task);
    const promise = task.settled.then((settlement) => {
      if (settlement.status === 'rejected') throw settlement.reason;
    });
    void promise.catch(() => undefined);
    return promise;
  }

  async drain(): Promise<unknown[]> {
    const failures: unknown[] = [];
    while (this.#pending.size !== 0) {
      const settlements = await Promise.all([...this.#pending].map((task) => task.settled));
      for (const settlement of settlements) {
        if (settlement.status === 'rejected') failures.push(settlement.reason);
      }
    }
    return failures;
  }
}
