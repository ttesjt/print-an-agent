import { AgentRunError } from '../types/errors.js';
import { composeExecutionSignal } from '@print-an-agent/workflow-core';

type OperationExecutionOutcome<TOutput> =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'completed'; output: TOutput }>
  | Readonly<{ status: 'failed'; error: unknown }>;

export type AgentOperationExecutorOutcome =
  | Readonly<{ status: 'completed' }>
  | Readonly<{ status: 'failed'; error: unknown }>;

interface AgentOperationExecutionProtocolOptions<TOutput> {
  readonly operationName: string;
  readonly containsCustomExecutor: boolean;
  readonly parentSignal: AbortSignal;
  readonly executePlan: (signal: AbortSignal) => Promise<TOutput>;
}

/** Internal fail-closed state machine for one Agent Operation Run. */
export class AgentOperationExecutionProtocol<TOutput> {
  readonly #options: AgentOperationExecutionProtocolOptions<TOutput>;
  #started = false;
  #executionPromise: Promise<void> | undefined;
  #executionController: AbortController | undefined;
  #protocolFailure: AgentRunError | undefined;
  #outcome: OperationExecutionOutcome<TOutput> = Object.freeze({ status: 'pending' });

  constructor(options: AgentOperationExecutionProtocolOptions<TOutput>) {
    this.#options = options;
  }

  readonly execute = (executionSignal: AbortSignal): Promise<void> => {
    if (this.#protocolFailure !== undefined) {
      return this.#createHandledRejection(this.#protocolFailure);
    }
    if (!(executionSignal instanceof AbortSignal)) {
      return this.#createHandledRejection(
        this.#lockProtocolFailure(
          'AGENT_RUN_EXECUTION_SIGNAL_INVALID',
          `Agent Operation "${this.#options.operationName}" Run executor supplied an invalid signal.`
        )
      );
    }
    if (this.#started) {
      return this.#createHandledRejection(
        this.#lockProtocolFailure(
          'AGENT_RUN_EXECUTION_REENTERED',
          `Agent Operation "${this.#options.operationName}" Run executor cannot execute the same Run more than once.`
        )
      );
    }
    this.#started = true;

    let runSignal = composeExecutionSignal([this.#options.parentSignal, executionSignal]);
    if (this.#options.containsCustomExecutor) {
      this.#executionController = new AbortController();
      runSignal = composeExecutionSignal([
        this.#options.parentSignal,
        executionSignal,
        this.#executionController.signal,
      ]);
    }

    this.#executionPromise = this.#options
      .executePlan(runSignal)
      .then((output) => {
        this.#outcome = Object.freeze({ status: 'completed', output });
      })
      .catch((error: unknown) => {
        this.#outcome = Object.freeze({ status: 'failed', error });
        throw error;
      });
    // Runtime drainage remains authoritative even when a custom executor forgets to await.
    void this.#executionPromise.catch(() => undefined);
    return this.#executionPromise;
  };

  async settleExecutor(outcome: AgentOperationExecutorOutcome): Promise<TOutput> {
    if (this.#options.containsCustomExecutor && outcome.status === 'completed') {
      if (!this.#started) {
        this.#lockProtocolFailure(
          'AGENT_RUN_EXECUTION_MISSING',
          `Agent Operation "${this.#options.operationName}" Run executor completed without executing the Run.`
        );
      } else if (this.#outcome.status === 'pending' && this.#protocolFailure === undefined) {
        this.#lockProtocolFailure(
          'AGENT_RUN_EXECUTION_INCOMPLETE',
          `Agent Operation "${this.#options.operationName}" Run executor completed before the Run settled.`
        );
      }
    }

    if (this.#protocolFailure !== undefined || outcome.status === 'failed') {
      this.#cancelPendingExecution(
        this.#protocolFailure ?? (outcome.status === 'failed' ? outcome.error : undefined)
      );
      await this.#drainExecution();
      if (this.#protocolFailure !== undefined) throw this.#protocolFailure;
      if (outcome.status === 'failed') throw outcome.error;
    }

    if (this.#outcome.status === 'failed') throw this.#outcome.error;
    if (this.#outcome.status === 'pending') {
      throw new AgentRunError(
        'AGENT_RUN_EXECUTION_INCOMPLETE',
        `Agent Operation "${this.#options.operationName}" Run did not settle.`,
        this.#options.operationName
      );
    }
    return this.#outcome.output;
  }

  #createHandledRejection(error: Error): Promise<void> {
    const rejection = Promise.reject(error);
    void rejection.catch(() => undefined);
    return rejection;
  }

  #lockProtocolFailure(code: AgentRunError['code'], message: string): AgentRunError {
    this.#protocolFailure ??= new AgentRunError(code, message, this.#options.operationName);
    this.#cancelPendingExecution(this.#protocolFailure);
    return this.#protocolFailure;
  }

  #cancelPendingExecution(reason: unknown): void {
    if (
      this.#executionPromise !== undefined &&
      this.#outcome.status === 'pending' &&
      this.#executionController !== undefined &&
      !this.#executionController.signal.aborted
    ) {
      this.#executionController.abort(reason);
    }
  }

  async #drainExecution(): Promise<void> {
    if (this.#executionPromise === undefined) return;
    try {
      await this.#executionPromise;
    } catch {
      // The locked protocol/executor failure remains authoritative after drainage.
    }
  }
}
