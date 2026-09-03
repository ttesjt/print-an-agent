export type AgentCompositionErrorCode =
  | 'AGENT_COMPOSITION_EXTENSION_INVALID'
  | 'AGENT_COMPOSITION_OPERATION_NAME_CONFLICT'
  | 'AGENT_COMPOSITION_RESOURCE_NAME_CONFLICT';

export class AgentCompositionError extends Error {
  readonly code: AgentCompositionErrorCode;
  readonly subjectName: string | undefined;

  constructor(code: AgentCompositionErrorCode, message: string, subjectName?: string) {
    super(message);
    this.name = 'AgentCompositionError';
    this.code = code;
    this.subjectName = subjectName;
  }
}
