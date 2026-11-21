import { expectTypeOf } from 'vitest';
import {
  defineTool,
  parseToolArguments,
  type ToolCallId,
  type ToolDefinition,
  type ToolName,
} from '../../src/index.js';

const parameters = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    options: {
      type: 'object',
      properties: { limit: { type: 'integer' }, exact: { type: 'boolean' } },
      required: ['limit', 'exact'],
      additionalProperties: false,
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['query', 'options', 'tags'],
  additionalProperties: false,
} as const;

interface Arguments {
  readonly query: string;
  readonly options: { readonly limit: number; readonly exact: boolean };
  readonly tags: readonly string[];
}

const tool = defineTool({
  name: 'lookup',
  description: 'Looks up typed values.',
  parameters,
  execute: ({ arguments: input, callId, signal }) => {
    expectTypeOf(input).toEqualTypeOf<Arguments>();
    expectTypeOf(callId).toEqualTypeOf<ToolCallId>();
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
    return Promise.resolve({ text: input.query });
  },
});

expectTypeOf(tool).toEqualTypeOf<ToolDefinition<typeof parameters>>();

expectTypeOf(parseToolArguments(parameters, undefined)).toEqualTypeOf<Arguments>();

expectTypeOf<ToolName>().not.toEqualTypeOf<ToolCallId>();

export function checkToolInputContract(callId: ToolCallId, signal: AbortSignal): void {
  // @ts-expect-error The required nested properties must survive generic inference.
  void tool.execute({ callId, signal, arguments: { query: 'lookup' } });
  const input = parseToolArguments(parameters, {});
  // @ts-expect-error Parsed argument collections are readonly.
  input.tags[0] = 'extra';
}
