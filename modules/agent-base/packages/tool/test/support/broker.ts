import { vi } from 'vitest';
import {
  createBoundedToolRuntime,
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  defineTool,
  defineToolPermissionPolicy,
  type ToolExecutionPolicy,
  type ToolExecutionRequest,
} from '../../src/index.js';

const inputSchema = {
  type: 'object',
  properties: { value: { type: 'string', maxLength: 100 } },
  required: ['value'],
  additionalProperties: false,
} as const;

const allowed = defineToolPermissionPolicy({
  responsibility: ['echo'],
  actor: ['echo'],
  product: ['echo'],
  runtime: ['echo'],
});

export function policy(overrides: Partial<ToolExecutionPolicy> = {}): ToolExecutionPolicy {
  return { ...DEFAULT_TOOL_EXECUTION_POLICY, ...overrides };
}

export function runtimeFor(
  execute: (value: string, signal: AbortSignal) => Promise<string>,
  options: { executionPolicy?: ToolExecutionPolicy; signal?: AbortSignal } = {}
) {
  const handler = vi.fn(async ({ arguments: input, signal }: ToolExecutionRequest<EchoInput>) => ({
    text: await execute(input.value, signal),
  }));
  const tool = defineTool({
    name: 'echo',
    description: 'Returns a deterministic value.',
    parameters: inputSchema,
    execute: handler,
  });
  let now = 0;
  const runtime = createBoundedToolRuntime({
    registry: createToolRegistry([tool]),
    permissionPolicy: allowed,
    executionPolicy: options.executionPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY,
    signal: options.signal ?? new AbortController().signal,
    clock: () => ++now,
  });
  return { runtime, handler };
}

type EchoInput = Readonly<{ value: string }>;
