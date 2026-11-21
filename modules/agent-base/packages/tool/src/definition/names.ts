import { AgentToolError } from '../errors.js';
import type { ToolName } from '../types/identity.js';

const TOOL_NAME_MAX_LENGTH = 64;

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;

export function parseToolName(value: unknown): ToolName {
  if (
    typeof value !== 'string' ||
    value.length > TOOL_NAME_MAX_LENGTH ||
    !TOOL_NAME_PATTERN.test(value)
  ) {
    throw new AgentToolError(
      'TOOL_DEFINITION_INVALID',
      `Tool name must contain 1-${TOOL_NAME_MAX_LENGTH} letters, digits, underscores, or hyphens and start with a letter.`
    );
  }
  return value as ToolName;
}
