import { AgentSessionError, MAX_SESSION_COMPACTION_CHARACTERS } from '@print-an-agent/base-session';
import type { ContextModelMessage } from '@print-an-agent/model-invocation-core';

export function cloneMemoryContext(message: ContextModelMessage): ContextModelMessage {
  return Object.freeze({ ...message });
}

export function validateMemoryContext(message: ContextModelMessage): ContextModelMessage {
  if (
    message.role !== 'context' ||
    typeof message.text !== 'string' ||
    message.text.length === 0 ||
    message.text.length > MAX_SESSION_COMPACTION_CHARACTERS ||
    !Number.isSafeInteger(message.timestamp) ||
    message.timestamp < 0
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      'Session compaction context message is invalid.'
    );
  }
  return cloneMemoryContext(message);
}
