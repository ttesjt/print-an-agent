import type { ToolObjectSchema, ToolSchemaValue } from '@print-an-agent/model-invocation-core';
import { AgentToolError } from '../errors.js';
import type { ToolExecutionRequest } from '../types/handler.js';
import { parseToolName } from './names.js';
import { freezeSchema, validateSchema } from './schemas.js';
import type { DefineToolInput, ToolDefinition } from './types.js';

const TOOL_DESCRIPTION_MAX_LENGTH = 1_024;

export function defineTool<const S extends ToolObjectSchema>(
  input: DefineToolInput<S>
): ToolDefinition<S> {
  const name = parseToolName(input.name);
  if (
    typeof input.description !== 'string' ||
    input.description.trim().length === 0 ||
    input.description.length > TOOL_DESCRIPTION_MAX_LENGTH
  ) {
    throw new AgentToolError(
      'TOOL_DEFINITION_INVALID',
      `Tool description must contain 1-${TOOL_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  validateSchema(input.parameters, 0);
  return Object.freeze({
    name,
    description: input.description,
    parameters: freezeSchema(input.parameters),
    execute: (request: ToolExecutionRequest<ToolSchemaValue<S>>) => input.execute(request),
  });
}
