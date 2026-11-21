import { AgentToolError } from '../errors.js';
import type { ToolCallId } from '../types/identity.js';

const TOOL_CALL_ID_MAX_LENGTH = 128;

const TOOL_CALL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

export function parseToolCallId(value: unknown): ToolCallId {
  if (
    typeof value !== 'string' ||
    value.length > TOOL_CALL_ID_MAX_LENGTH ||
    !TOOL_CALL_ID_PATTERN.test(value)
  ) {
    throw new AgentToolError(
      'TOOL_CALL_ID_INVALID',
      `Tool call ID must contain 1-${TOOL_CALL_ID_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value as ToolCallId;
}

export function serializedCharacterCount(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new AgentToolError('TOOL_ARGUMENTS_INVALID', 'Tool arguments are not JSON-compatible.');
    }
    return serialized.length;
  } catch (cause: unknown) {
    if (cause instanceof AgentToolError) throw cause;
    throw new AgentToolError('TOOL_ARGUMENTS_INVALID', 'Tool arguments are not JSON-compatible.', {
      cause,
    });
  }
}
