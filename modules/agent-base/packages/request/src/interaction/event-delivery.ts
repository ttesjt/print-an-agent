import {
  ModelInvocationError,
  type ModelInteractionEvent,
  type ModelInteractionEventSink,
} from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../errors.js';

interface InteractionEventDeliveryOptions {
  readonly signal: AbortSignal;
  readonly capacity: number;
  readonly dispatch: ModelInteractionEventSink;
}

/** Owns accepted work until it settles, even if the Engine ignores an emit Promise. */
export class InteractionEventDelivery {
  readonly #options: InteractionEventDeliveryOptions;
  readonly #controller = new AbortController();
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  #accepting = true;
  #failure: { readonly cause: unknown } | undefined;
  #cancellation: ModelInvocationError | undefined;
  #currentEvent: ModelInteractionEvent | undefined;

  constructor(options: InteractionEventDeliveryOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new AgentRequestError(
        'REQUEST_POLICY_INVALID',
        'Interaction event capacity must be a positive safe integer.'
      );
    }
    this.#options = options;
    options.signal.addEventListener('abort', this.#onAbort, { once: true });
    if (options.signal.aborted) this.#onAbort();
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  get currentEvent(): ModelInteractionEvent | undefined {
    return this.#currentEvent;
  }

  readonly #onAbort = (): void => {
    const reason = this.#options.signal.reason as unknown;
    const timedOut = reason instanceof DOMException && reason.name === 'TimeoutError';
    this.#cancellation = new ModelInvocationError(
      timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
      timedOut ? 'Request interaction timed out.' : 'Request interaction was cancelled.'
    );
    this.#accepting = false;
    // Stop ingress immediately, but let a cooperative Engine retain its own cancellation error.
    // The fallback is observed if it attempts more delivery or returns success instead.
    this.#controller.abort(reason);
  };

  readonly emit: ModelInteractionEventSink = (event) => {
    if (this.#failure !== undefined) return this.#reject(this.#failure.cause);
    if (this.#cancellation !== undefined) return this.#reject(this.#cancellation);
    if (!this.#accepting) {
      return this.#reject(
        new AgentRequestError(
          'REQUEST_INTERACTION_EVENT_DELIVERY_CLOSED',
          'Request interaction no longer accepts events.'
        )
      );
    }
    if (this.#pending >= this.#options.capacity) {
      return this.#reject(
        this.stop(
          new AgentRequestError(
            'REQUEST_INTERACTION_EVENT_QUEUE_FULL',
            'Request interaction event capacity was exceeded.'
          )
        )
      );
    }
    this.#pending++;
    const work = this.#tail.then(async () => {
      this.assertHealthy();
      this.#currentEvent = event;
      try {
        await this.#options.dispatch(event);
        this.assertHealthy();
      } finally {
        this.#currentEvent = undefined;
      }
    });
    // Attach both observers synchronously. The tail drains without rejecting; work retains its error.
    this.#tail = work.then(
      () => {
        this.#pending--;
      },
      (cause: unknown) => {
        this.#pending--;
        this.stop(cause);
      }
    );
    return work;
  };

  stop(cause: unknown): unknown {
    this.#failure ??= { cause };
    this.#accepting = false;
    this.#controller.abort(this.#failure.cause);
    return this.#failure.cause;
  }

  assertHealthy(): void {
    if (this.#failure !== undefined) throw this.#failure.cause;
    if (this.#cancellation !== undefined) throw this.#cancellation;
  }

  async finish(): Promise<void> {
    this.#accepting = false;
    await this.drain();
    this.assertHealthy();
  }

  drain(): Promise<void> {
    return this.#tail;
  }

  dispose(): void {
    this.#accepting = false;
    this.#options.signal.removeEventListener('abort', this.#onAbort);
  }

  #reject(cause: unknown): Promise<void> {
    const rejected = Promise.resolve().then(() => {
      throw cause;
    });
    void rejected.catch(() => undefined);
    return rejected;
  }
}
