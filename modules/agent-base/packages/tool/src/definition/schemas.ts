import type { ToolValueSchema } from '@print-an-agent/model-invocation-core';
import { AgentToolError } from '../errors.js';

const SCHEMA_MAX_DEPTH = 8;

const SCHEMA_MAX_PROPERTIES = 64;

function validateFiniteBound(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new AgentToolError('TOOL_SCHEMA_INVALID', `${name} must be finite.`);
  }
}

export function validateSchema(schema: ToolValueSchema, depth: number): void {
  if (depth > SCHEMA_MAX_DEPTH) {
    throw new AgentToolError(
      'TOOL_SCHEMA_INVALID',
      `Tool schema exceeds maximum depth ${SCHEMA_MAX_DEPTH}.`
    );
  }
  if (schema.type === 'string') {
    if (
      schema.minLength !== undefined &&
      (!Number.isSafeInteger(schema.minLength) || schema.minLength < 0)
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'String minLength must be non-negative.');
    }
    if (
      schema.maxLength !== undefined &&
      (!Number.isSafeInteger(schema.maxLength) || schema.maxLength < 0)
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'String maxLength must be non-negative.');
    }
    if (
      schema.minLength !== undefined &&
      schema.maxLength !== undefined &&
      schema.minLength > schema.maxLength
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'String length bounds contradict.');
    }
    if (
      schema.enum !== undefined &&
      (schema.enum.length === 0 || new Set(schema.enum).size !== schema.enum.length)
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'String enum must be non-empty and unique.');
    }
    return;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    validateFiniteBound(schema.minimum, 'minimum');
    validateFiniteBound(schema.maximum, 'maximum');
    if (
      schema.minimum !== undefined &&
      schema.maximum !== undefined &&
      schema.minimum > schema.maximum
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'Numeric bounds contradict.');
    }
    return;
  }
  if (schema.type === 'array') {
    if (
      schema.maxItems !== undefined &&
      (!Number.isSafeInteger(schema.maxItems) || schema.maxItems < 0)
    ) {
      throw new AgentToolError('TOOL_SCHEMA_INVALID', 'Array maxItems must be non-negative.');
    }
    validateSchema(schema.items, depth + 1);
    return;
  }
  if (schema.type === 'object') {
    const propertyNames = Object.keys(schema.properties);
    if (propertyNames.length > SCHEMA_MAX_PROPERTIES) {
      throw new AgentToolError(
        'TOOL_SCHEMA_INVALID',
        `Tool schema object exceeds ${SCHEMA_MAX_PROPERTIES} properties.`
      );
    }
    if (
      schema.additionalProperties !== false ||
      schema.required.length !== propertyNames.length ||
      new Set(schema.required).size !== schema.required.length ||
      schema.required.some((name) => !Object.hasOwn(schema.properties, name))
    ) {
      throw new AgentToolError(
        'TOOL_SCHEMA_INVALID',
        'Object schemas must reject additional properties and require every declared property exactly once.'
      );
    }
    for (const property of Object.values(schema.properties)) validateSchema(property, depth + 1);
  }
}

export function freezeSchema<S extends ToolValueSchema>(schema: S): S;
export function freezeSchema(schema: ToolValueSchema): ToolValueSchema {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, child]) => [name, freezeSchema(child)])
    );
    return Object.freeze({
      ...schema,
      properties: Object.freeze(properties),
      required: Object.freeze([...schema.required]),
    });
  }
  if (schema.type === 'array') {
    return Object.freeze({ ...schema, items: freezeSchema(schema.items) });
  }
  if (schema.type === 'string' && schema.enum !== undefined) {
    return Object.freeze({ ...schema, enum: Object.freeze([...schema.enum]) });
  }
  return Object.freeze({ ...schema });
}
