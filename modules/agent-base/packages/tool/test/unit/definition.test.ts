import { expect, it } from 'vitest';
import { defineTool, parseToolArguments } from '../../src/index.js';
import { createLookupTool, nestedSchema } from '../support/definition.js';
import { expectAgentToolError } from '../support/errors.js';

it('validates and defensively copies nested arguments', () => {
  const source = { query: 'alpha', options: { limit: 2, exact: true } };
  const parsed = parseToolArguments(nestedSchema, source);

  expect(parsed).toEqual(source);
  expect(parsed).not.toBe(source);
  expect(parsed.options).not.toBe(source.options);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.options)).toBe(true);
});

it.each([
  { query: '', options: { limit: 2, exact: true } },
  { query: 'alpha', options: { limit: 0, exact: true } },
  { query: 'alpha', options: { limit: 2, exact: 'yes' } },
  { query: 'alpha', options: { limit: 2, exact: true }, extra: true },
])('rejects malformed arguments before execution', (arguments_) => {
  expectAgentToolError(
    () => parseToolArguments(nestedSchema, arguments_),
    'TOOL_ARGUMENTS_INVALID'
  );
});

it('rejects contradictory schemas', () => {
  expectAgentToolError(
    () =>
      defineTool({
        name: 'invalid',
        description: 'Invalid schema.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: [],
          additionalProperties: false,
        },
        execute: () => Promise.resolve({ text: 'unused' }),
      }),
    'TOOL_SCHEMA_INVALID'
  );
});

it('validates tool identity at construction', () => {
  expectAgentToolError(
    () =>
      defineTool({
        name: 'not valid',
        description: 'Invalid name.',
        parameters: nestedSchema,
        execute: createLookupTool().execute,
      }),
    'TOOL_DEFINITION_INVALID'
  );
});
