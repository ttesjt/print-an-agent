import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  ModelInvocationError,
  type ToolExecutionOutcome,
} from '@print-an-agent/model-invocation-core';
import type { InteractionTools } from '@print-an-agent/model-invocation-core';
import { type ToolDescriptor, type ToolValueSchema } from '@print-an-agent/model-invocation-core';
import { Type, type TSchema } from 'typebox';

export interface PiToolAdapterState {
  readonly attemptedCallIds: Set<string>;
  terminalFailure?: Readonly<{ cause: unknown }>;
}

function toPiSchema(schema: ToolValueSchema): TSchema {
  if (schema.type === 'string') {
    if (schema.enum !== undefined) {
      const literals = schema.enum.map((value) => Type.Literal(value));
      const first = literals[0];
      if (first === undefined) {
        throw new ModelInvocationError(
          'MODEL_RUNTIME_PROTOCOL_INVALID',
          'String enum cannot be empty.'
        );
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
  const required = new Set(schema.required);
  for (const [name, child] of Object.entries(schema.properties)) {
    const property = toPiSchema(child);
    properties[name] = required.has(name) ? property : Type.Optional(property);
  }
  return Type.Object(properties, { additionalProperties: false });
}

function toPiToolFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Tool runtime rejected with a non-Error.');
}

function createPiTool(
  descriptor: ToolDescriptor,
  runtime: InteractionTools,
  state: PiToolAdapterState
): AgentTool {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    parameters: toPiSchema(descriptor.parameters),
    executionMode: 'sequential',
    async execute(toolCallId, arguments_, signal) {
      // Pi recovers from tool errors within a batch; a rejected port must stop further side effects.
      if (state.terminalFailure !== undefined) {
        throw toPiToolFailure(state.terminalFailure.cause);
      }
      state.attemptedCallIds.add(toolCallId);
      let outcome: ToolExecutionOutcome;
      try {
        outcome = await runtime.execute(
          { callId: toolCallId, toolName: descriptor.name, arguments: arguments_ },
          signal === undefined ? undefined : { signal }
        );
      } catch (cause: unknown) {
        state.terminalFailure ??= { cause };
        throw toPiToolFailure(cause);
      }
      // A declared handler error is model-visible; a rejected execution port is authoritative.
      if (outcome.status === 'handler-error') throw new Error(outcome.text);
      return { content: [{ type: 'text', text: outcome.text }], details: Object.freeze({}) };
    },
  };
}

export function createPiTools(runtime: InteractionTools, state: PiToolAdapterState): AgentTool[] {
  return runtime.tools.map((descriptor) => createPiTool(descriptor, runtime, state));
}
