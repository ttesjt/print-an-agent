import {
  AgentObservabilityError,
  validateAgentTraceEvent,
  type AgentTraceEvent,
  type AgentTraceEventSink,
} from '@ta-agent/base-observability';

export interface MemoryAgentTraceAdapterOptions {
  readonly maxEvents: number;
}

export interface AgentTraceInspectionOptions {
  readonly agentRunId?: string;
}

export interface AgentTraceSnapshot {
  readonly events: readonly AgentTraceEvent[];
  readonly droppedEvents: number;
}

const MAX_MEMORY_TRACE_EVENTS = 100_000;

export class MemoryAgentTraceAdapter implements AgentTraceEventSink {
  readonly #maxEvents: number;
  readonly #events: AgentTraceEvent[] = [];
  #droppedEvents = 0;

  constructor(options: MemoryAgentTraceAdapterOptions) {
    if (
      !Number.isSafeInteger(options.maxEvents) ||
      options.maxEvents < 1 ||
      options.maxEvents > MAX_MEMORY_TRACE_EVENTS
    ) {
      throw new AgentObservabilityError(
        'TRACE_CONFIGURATION_INVALID',
        `Memory trace maxEvents must be an integer between 1 and ${MAX_MEMORY_TRACE_EVENTS}.`
      );
    }
    this.#maxEvents = options.maxEvents;
  }

  record(event: AgentTraceEvent): Promise<void> {
    try {
      validateAgentTraceEvent(event);
      if (this.#events.length === this.#maxEvents) {
        this.#events.shift();
        this.#droppedEvents += 1;
      }
      this.#events.push(Object.freeze(structuredClone(event)));
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new AgentObservabilityError(
              'TRACE_EVENT_INVALID',
              'Memory trace adapter rejected a non-Error validation failure.',
              { cause: error }
            )
      );
    }
  }

  inspect(options: AgentTraceInspectionOptions = {}): AgentTraceSnapshot {
    const events =
      options.agentRunId === undefined
        ? this.#events
        : this.#events.filter((event) => event.agentRunId === options.agentRunId);
    return Object.freeze({
      events: Object.freeze([...events]),
      droppedEvents: this.#droppedEvents,
    });
  }
}
