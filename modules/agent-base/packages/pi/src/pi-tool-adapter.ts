import { type AgentTool } from '@earendil-works/pi-agent-core';
import {
  AgentToolError,
  type ToolDescriptor,
  type ToolRuntime,
  type ToolValueSchema,
} from '@ta-agent/base-tool';
import { Type, type TSchema } from 'typebox';

export interface PiToolAdapterState {
  readonly attemptedCallIds: Set<string>;
  terminalFailure?: AgentToolError;
}

function toPiSchema(schema: ToolValueSchema): TSchema {
  if (schema.type === 'string') {
    if (schema.enum !== undefined) {
      const literals = schema.enum.map((value) => Type.Literal(value));
      const first = literals[0];
      if (first === undefined) {
        throw new AgentToolError('TOOL_SCHEMA_INVALID', 'String enum cannot be empty.');
      }
      return literals.length === 1 ? first : Type.Union(literals);
    }
    return Type.String({
      ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
      ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
    });
  }
  if (schema.type === 'number') {
    return Type.Number({
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
      ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
    });
  }
  if (schema.type === 'integer') {
    return Type.Integer({
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
      ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
    });
  }
  if (schema.type === 'boolean') return Type.Boolean();
  if (schema.type === 'null') return Type.Null();
  if (schema.type === 'array') {
    return Type.Array(toPiSchema(schema.items), {
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    });
  }
  const properties: Record<string, TSchema> = {};
  for (const [name, child] of Object.entries(schema.properties)) {
    properties[name] = toPiSchema(child);
  }
  return Type.Object(properties, { additionalProperties: false });
}

function createPiTool(
  descriptor: ToolDescriptor,
  runtime: ToolRuntime,
  state: PiToolAdapterState
): AgentTool {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    parameters: toPiSchema(descriptor.parameters),
    executionMode: 'sequential',
    async execute(toolCallId, arguments_, _signal) {
      state.attemptedCallIds.add(toolCallId);
      try {
        const outcome = await runtime.execute({
          callId: toolCallId,
          toolName: descriptor.name,
          arguments: arguments_,
        });
        if (outcome.status === 'handler-error') throw new Error(outcome.text);
        return { content: [{ type: 'text', text: outcome.text }], details: Object.freeze({}) };
      } catch (cause: unknown) {
        if (cause instanceof AgentToolError) state.terminalFailure = cause;
        throw cause instanceof Error ? cause : new Error('Tool runtime rejected with a non-Error.');
      }
    },
  };
}

export function createPiTools(runtime: ToolRuntime, state: PiToolAdapterState): AgentTool[] {
  return runtime.tools.map((descriptor) => createPiTool(descriptor, runtime, state));
}
