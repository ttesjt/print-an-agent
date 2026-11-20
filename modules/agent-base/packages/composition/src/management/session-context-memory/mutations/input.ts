import { AgentSessionError } from '@print-an-agent/base-session';
import {
  parseDeterministicMemoryRequest,
  parseItemCommands,
  type ApplyMemoryInput,
  type MutationRequest,
} from '@print-an-agent/context-memory';

export function applyInput(value: unknown): { input: ApplyMemoryInput; request: MutationRequest } {
  const { data, request } = parseDeterministicMemoryRequest('apply', value);
  if (
    typeof data.expectedRevision !== 'number' ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 1
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid expected Memory revision.');
  return {
    request,
    input: {
      memoryId: request.memoryId,
      requestId: request.requestId,
      expectedRevision: data.expectedRevision,
      commands: parseItemCommands(data.commands),
    },
  };
}
