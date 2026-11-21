import { ModelInvocationError, type ToolValueSchema } from '@print-an-agent/model-invocation-core';
import { Type, type TSchema } from 'typebox';

export function toPiToolSchema(schema: ToolValueSchema): TSchema {
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
    return Type.Array(toPiToolSchema(schema.items), {
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    });
  }
  const properties: Record<string, TSchema> = {};
  const required = new Set(schema.required);
  for (const [name, child] of Object.entries(schema.properties)) {
    const property = toPiToolSchema(child);
    properties[name] = required.has(name) ? property : Type.Optional(property);
  }
  return Type.Object(properties, { additionalProperties: false });
}
