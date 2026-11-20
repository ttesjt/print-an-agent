export type ManagedAgentCompositionErrorCode = 'MANAGED_AGENT_COMPOSITION_INVALID';

export class ManagedAgentCompositionError extends Error {
  readonly code: ManagedAgentCompositionErrorCode;
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = 'ManagedAgentCompositionError';
    this.code = 'MANAGED_AGENT_COMPOSITION_INVALID';
    this.fieldPath = fieldPath;
  }
}
