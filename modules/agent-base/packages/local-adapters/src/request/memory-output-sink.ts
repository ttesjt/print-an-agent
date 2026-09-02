import {
  AgentRequestError,
  type AgentResponse,
  type OutputFailure,
  type OutputOpenEvent,
  type OutputSink,
  type OutputTextDeltaEvent,
} from '@ta-agent/base-request';

export type MemoryOutputSnapshot =
  | Readonly<{ status: 'pending'; events: readonly OutputTextDeltaEvent[] }>
  | Readonly<{
      status: 'open';
      openEvent: OutputOpenEvent;
      events: readonly OutputTextDeltaEvent[];
    }>
  | Readonly<{
      status: 'closed';
      openEvent: OutputOpenEvent;
      events: readonly OutputTextDeltaEvent[];
      response: AgentResponse;
    }>
  | Readonly<{
      status: 'failed';
      openEvent?: OutputOpenEvent;
      events: readonly OutputTextDeltaEvent[];
      failure: OutputFailure;
    }>;

export class MemoryOutputSink implements OutputSink {
  #openEvent: OutputOpenEvent | undefined;
  #response: AgentResponse | undefined;
  #failure: OutputFailure | undefined;
  readonly #events: OutputTextDeltaEvent[] = [];

  open(event: OutputOpenEvent): Promise<void> {
    return Promise.resolve().then(() => {
      if (
        this.#openEvent !== undefined ||
        this.#response !== undefined ||
        this.#failure !== undefined
      ) {
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'OutputSink can open exactly once before reaching a terminal state.'
        );
      }
      this.#openEvent = Object.freeze({ ...event });
    });
  }

  write(event: OutputTextDeltaEvent): Promise<void> {
    return Promise.resolve().then(() => {
      if (
        this.#openEvent === undefined ||
        this.#response !== undefined ||
        this.#failure !== undefined
      ) {
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'OutputSink can write only while open.'
        );
      }
      this.#events.push(Object.freeze({ ...event }));
    });
  }

  close(response: AgentResponse): Promise<void> {
    return Promise.resolve().then(() => {
      if (
        this.#openEvent === undefined ||
        this.#response !== undefined ||
        this.#failure !== undefined
      ) {
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'OutputSink can close exactly once after opening.'
        );
      }
      this.#response = Object.freeze({
        ...response,
        message: Object.freeze({
          ...response.message,
          usage: Object.freeze({ ...response.message.usage }),
        }),
      });
    });
  }

  fail(failure: OutputFailure): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.#response !== undefined) {
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'A closed OutputSink cannot transition to failed.'
        );
      }
      if (this.#failure !== undefined) return;
      this.#failure = Object.freeze({ ...failure });
    });
  }

  inspect(): MemoryOutputSnapshot {
    const events = Object.freeze(this.#events.map((event) => Object.freeze({ ...event })));
    if (this.#response !== undefined && this.#openEvent !== undefined) {
      return Object.freeze({
        status: 'closed',
        openEvent: this.#openEvent,
        events,
        response: this.#response,
      });
    }
    if (this.#failure !== undefined) {
      return Object.freeze({
        status: 'failed',
        ...(this.#openEvent === undefined ? {} : { openEvent: this.#openEvent }),
        events,
        failure: this.#failure,
      });
    }
    if (this.#openEvent !== undefined) {
      return Object.freeze({ status: 'open', openEvent: this.#openEvent, events });
    }
    return Object.freeze({ status: 'pending', events });
  }
}
