import { AgentObservabilityError } from '../errors.js';
import type {
  AgentTraceEmitter,
  AgentTraceEventSink,
  AgentTraceSinkFailureReporter,
} from './types/ports.js';
import { snapshotAgentTraceEventDetails, TRACE_SCHEMA_VERSION } from '../events/index.js';
import type { AgentTraceEvent, AgentTraceEventDetails } from '../events/index.js';
import type { CreateAgentTraceEmitterOptions } from './types/options.js';

const EMITTER_IDENTIFIER_MAX_LENGTH = 128;

export const NOOP_AGENT_TRACE_SINK: AgentTraceEventSink = Object.freeze({
  record: () => Promise.resolve(),
});

function validateIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > EMITTER_IDENTIFIER_MAX_LENGTH
  ) {
    throw new AgentObservabilityError(
      'TRACE_CONFIGURATION_INVALID',
      `${name} must contain 1-${EMITTER_IDENTIFIER_MAX_LENGTH} characters.`
    );
  }
  return value;
}

function requireTimestamp(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentObservabilityError(
      'TRACE_CONFIGURATION_INVALID',
      'Agent trace clock must return a non-negative safe integer timestamp.'
    );
  }
  return timestamp;
}

async function reportSinkFailure(
  reporter: AgentTraceSinkFailureReporter | undefined,
  event: AgentTraceEvent,
  cause: unknown
): Promise<void> {
  if (reporter === undefined) return;
  try {
    await reporter(Object.freeze({ event, cause }));
  } catch {
    // Trace diagnostics are deliberately isolated from execution authority.
  }
}

class RunScopedAgentTraceEmitter implements AgentTraceEmitter {
  readonly agentId: string;
  readonly agentRunId: string;
  readonly #sink: AgentTraceEventSink;
  readonly #clock: () => number;
  readonly #onSinkFailure: AgentTraceSinkFailureReporter | undefined;
  #initialTimestamp: number | undefined;
  #sequence = 0;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(options: CreateAgentTraceEmitterOptions) {
    this.agentId = validateIdentifier(options.agentId, 'Agent trace agentId');
    this.agentRunId = validateIdentifier(options.agentRunId, 'Agent trace agentRunId');
    this.#sink = options.sink ?? NOOP_AGENT_TRACE_SINK;
    this.#clock = options.clock ?? Date.now;
    this.#onSinkFailure = options.onSinkFailure;
    this.#initialTimestamp = requireTimestamp(this.#clock);
  }

  async record(details: AgentTraceEventDetails): Promise<void> {
    const snapshot = snapshotAgentTraceEventDetails(details);
    const timestamp = this.#initialTimestamp ?? requireTimestamp(this.#clock);
    this.#initialTimestamp = undefined;
    const event = Object.freeze({
      ...snapshot,
      schemaVersion: TRACE_SCHEMA_VERSION,
      agentId: this.agentId,
      agentRunId: this.agentRunId,
      sequence: (this.#sequence += 1),
      timestamp,
    }) satisfies AgentTraceEvent;
    const write = this.#writeTail.then(async () => {
      try {
        await this.#sink.record(event);
      } catch (cause: unknown) {
        await reportSinkFailure(this.#onSinkFailure, event, cause);
      }
    });
    this.#writeTail = write;
    await write;
  }
}

export function createAgentTraceEmitter(
  options: CreateAgentTraceEmitterOptions
): AgentTraceEmitter {
  return new RunScopedAgentTraceEmitter(options);
}
