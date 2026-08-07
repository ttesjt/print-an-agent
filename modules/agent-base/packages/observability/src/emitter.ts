import { AgentObservabilityError } from './errors.js';
import type {
  AgentTraceEmitter,
  AgentTraceEvent,
  AgentTraceEventDetails,
  AgentTraceEventSink,
  AgentTraceSinkFailureReporter,
  CreateAgentTraceEmitterOptions,
} from './types.js';
import { validateAgentTraceEventDetails } from './validation.js';

const TRACE_IDENTIFIER_MAX_LENGTH = 128;
const TRACE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export const NOOP_AGENT_TRACE_SINK: AgentTraceEventSink = Object.freeze({
  record: () => Promise.resolve(),
});

function validateIdentifier(value: string, name: string): string {
  if (value.length === 0 || value.length > TRACE_IDENTIFIER_MAX_LENGTH) {
    throw new AgentObservabilityError(
      'TRACE_CONFIGURATION_INVALID',
      `${name} must contain 1-${TRACE_IDENTIFIER_MAX_LENGTH} characters.`
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
    validateAgentTraceEventDetails(details);
    const timestamp = this.#initialTimestamp ?? requireTimestamp(this.#clock);
    this.#initialTimestamp = undefined;
    const event = Object.freeze({
      ...details,
      schemaVersion: 1 as const,
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

export function traceErrorCode(error: unknown): string {
  if (error instanceof AggregateError && error.cause !== undefined) {
    return traceErrorCode(error.cause);
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string' && TRACE_ERROR_CODE_PATTERN.test(code)) return code;
  }
  return 'UNEXPECTED_ERROR';
}
