import { AgentDefinitionError } from '../errors.js';

export function validateOperationName(name: string): void {
  if (name.length === 0) {
    throw new AgentDefinitionError(
      'AGENT_OPERATION_NAME_INVALID',
      name,
      'Agent Operation names cannot be empty.'
    );
  }
}
