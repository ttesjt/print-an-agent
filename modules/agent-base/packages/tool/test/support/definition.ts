import { vi } from 'vitest';
import { defineTool, type ToolExecutionRequest } from '../../src/index.js';

export const nestedSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 20 },
    options: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 5 },
        exact: { type: 'boolean' },
      },
      required: ['limit', 'exact'],
      additionalProperties: false,
    },
  },
  required: ['query', 'options'],
  additionalProperties: false,
} as const;

export function createLookupTool() {
  return defineTool({
    name: 'lookup',
    description: 'Looks up a deterministic value.',
    parameters: nestedSchema,
    execute: vi.fn(({ arguments: input }: ToolExecutionRequest<LookupInput>) =>
      Promise.resolve({ text: `${input.query}:${input.options.limit}:${input.options.exact}` })
    ),
  });
}

type LookupInput = Readonly<{
  query: string;
  options: Readonly<{ limit: number; exact: boolean }>;
}>;
