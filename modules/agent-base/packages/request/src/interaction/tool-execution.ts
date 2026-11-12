import { AgentToolError } from '@print-an-agent/base-tool';
import type {
  InteractionTools,
  ToolCallProposal,
  ToolExecutionOptions,
  ToolExecutionOutcome,
} from '@print-an-agent/model-invocation-core';
import { composeExecutionSignal } from '@print-an-agent/workflow-core';

/** Request owns admitted Tool work; an Engine cannot discard its failure or lifetime. */
export class InteractionToolExecution {
  readonly signal: AbortSignal;
  readonly port: InteractionTools;
  readonly #controller = new AbortController();
  #tail: Promise<void> = Promise.resolve();
  readonly #stopDelivery: (cause: unknown) => unknown;
  #accepting = true;
  #failure: { readonly cause: unknown } | undefined;

  constructor(
    tools: InteractionTools,
    signal: AbortSignal,
    stopDelivery: (cause: unknown) => unknown
  ) {
    this.signal = composeExecutionSignal([signal, this.#controller.signal]);
    this.#stopDelivery = stopDelivery;
    this.port = Object.freeze({
      tools: tools.tools,
      execute: (proposal: ToolCallProposal, options?: ToolExecutionOptions) => {
        if (!this.#accepting) {
          const cause = this.stop(
            new AgentToolError('TOOL_RUN_CLOSED', 'Interaction no longer accepts Tool calls.')
          );
          const rejected = Promise.resolve().then(() => {
            throw cause;
          });
          void rejected.catch(() => undefined);
          return rejected;
        }
        const execution = this.#tail.then(() => this.#execute(tools, proposal, options));
        // Observe rejection before starting the next admitted call, even if the Engine ignores it.
        this.#tail = execution.then(
          () => undefined,
          (cause: unknown) => {
            this.stop(cause);
          }
        );
        return execution;
      },
    });
  }

  async #execute(
    tools: InteractionTools,
    proposal: ToolCallProposal,
    options: ToolExecutionOptions | undefined
  ): Promise<ToolExecutionOutcome> {
    this.#assertHealthy();
    return tools.execute(proposal, {
      signal:
        options?.signal === undefined
          ? this.signal
          : composeExecutionSignal([this.signal, options.signal]),
    });
  }

  stop(cause: unknown): unknown {
    this.#accepting = false;
    this.#failure ??= { cause: this.#stopDelivery(cause) };
    this.#controller.abort(this.#failure.cause);
    return this.#failure.cause;
  }

  async finish(): Promise<void> {
    this.#accepting = false;
    await this.drain();
    this.#assertHealthy();
  }

  drain(): Promise<void> {
    return this.#tail;
  }

  #assertHealthy(): void {
    if (this.#failure !== undefined) throw this.#failure.cause;
  }
}
