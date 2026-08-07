import {
  AgentToolError,
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
  parseToolArguments,
  resolveEffectiveTools,
  type ToolExecutionRequest,
  validateToolExecutionPolicy,
} from '../../src/index.js';
import { describe, expect, it, vi } from 'vitest';

const nestedSchema = {
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

function createLookupTool() {
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

function expectAgentToolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected AgentToolError with code ${code}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentToolError);
    if (!(error instanceof AgentToolError)) return;
    expect(error.code).toBe(code);
  }
}

describe('Agent Base tool domain', () => {
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

  it('rejects contradictory schemas and duplicate registry names', () => {
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

    const tool = createLookupTool();
    expectAgentToolError(() => createToolRegistry([tool, tool]), 'TOOL_REGISTRY_DUPLICATE');
  });

  it('validates tool identity and execution policy at construction boundaries', () => {
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
    expectAgentToolError(
      () =>
        validateToolExecutionPolicy({
          maxToolCalls: 0,
          toolTimeoutMilliseconds: 1,
          maxArgumentCharacters: 1,
          maxResultCharacters: 2,
          maxTotalResultCharacters: 1,
        }),
      'TOOL_EXECUTION_POLICY_INVALID'
    );
  });

  it('uses the most restrictive permission intersection and rejects unknown policy names', () => {
    const tool = createLookupTool();
    const registry = createToolRegistry([tool]);
    const allowed = defineToolPermissionPolicy({
      task: ['lookup'],
      assignment: ['lookup'],
      product: ['lookup'],
      runtime: ['lookup'],
    });
    const denied = defineToolPermissionPolicy({
      task: ['lookup'],
      assignment: [],
      product: ['lookup'],
      runtime: ['lookup'],
    });

    expect(resolveEffectiveTools(registry, allowed).map(({ name }) => name)).toEqual(['lookup']);
    expect(resolveEffectiveTools(registry, denied)).toEqual([]);
    expectAgentToolError(
      () =>
        resolveEffectiveTools(
          registry,
          defineToolPermissionPolicy({
            task: ['missing'],
            assignment: [],
            product: [],
            runtime: [],
          })
        ),
      'TOOL_POLICY_INVALID'
    );
  });
});
