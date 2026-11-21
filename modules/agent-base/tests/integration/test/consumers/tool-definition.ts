import { defineTool, parseToolArguments } from '@print-an-agent/base-tool';

/** Inferred consumer declarations must resolve through the public Tool contracts. */
export function toolDefinition() {
  return defineTool({
    name: 'lookup',
    description: 'Looks up values supplied by the host.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        options: {
          type: 'object',
          properties: { limit: { type: 'integer' } },
          required: ['limit'],
          additionalProperties: false,
        },
      },
      required: ['query', 'options'],
      additionalProperties: false,
    },
    execute: ({ arguments: input }) =>
      Promise.resolve({ text: `${input.query}:${input.options.limit}` }),
  });
}

export function toolArguments(input: unknown) {
  return parseToolArguments(toolDefinition().parameters, input);
}
