export type AgentObservabilityErrorCode = 'TRACE_CONFIGURATION_INVALID' | 'TRACE_EVENT_INVALID';

export class AgentObservabilityError extends Error {
  readonly code: AgentObservabilityErrorCode;

  constructor(code: AgentObservabilityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentObservabilityError';
    this.code = code;
  }
}

export function invalidTraceEvent(message: string): never {
  throw new AgentObservabilityError('TRACE_EVENT_INVALID', message);
}
