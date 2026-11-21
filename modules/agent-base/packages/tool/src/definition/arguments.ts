import type {
  ToolObjectSchema,
  ToolSchemaValue,
  ToolValueSchema,
} from '@print-an-agent/model-invocation-core';
import { AgentToolError } from '../errors.js';

function invalidArguments(message: string): never {
  throw new AgentToolError('TOOL_ARGUMENTS_INVALID', message);
}

function parseSchemaValue(schema: ToolValueSchema, value: unknown, path: string): unknown {
  if (schema.type === 'string') {
    if (typeof value !== 'string') invalidArguments(`${path} must be a string.`);
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      invalidArguments(`${path} is shorter than ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      invalidArguments(`${path} is longer than ${schema.maxLength} characters.`);
    }
    if (schema.enum !== undefined && !schema.enum.includes(value)) {
      invalidArguments(`${path} is not an allowed value.`);
    }
    return value;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalidArguments(`${path} must be a finite number.`);
    }
    if (schema.type === 'integer' && !Number.isSafeInteger(value)) {
      invalidArguments(`${path} must be a safe integer.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      invalidArguments(`${path} is below the minimum.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      invalidArguments(`${path} is above the maximum.`);
    }
    return value;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') invalidArguments(`${path} must be a boolean.`);
    return value;
  }
  if (schema.type === 'null') {
    if (value !== null) invalidArguments(`${path} must be null.`);
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) invalidArguments(`${path} must be an array.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      invalidArguments(`${path} exceeds ${schema.maxItems} items.`);
    }
    return Object.freeze(
      value.map((child, index) => parseSchemaValue(schema.items, child, `${path}[${index}]`))
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidArguments(`${path} must be an object.`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const propertyNames = Object.keys(record);
  if (propertyNames.some((name) => !Object.hasOwn(schema.properties, name))) {
    invalidArguments(`${path} contains an unknown property.`);
  }
  const parsed = Object.fromEntries(
    Object.entries(schema.properties).map(([name, childSchema]) => {
      if (!Object.hasOwn(record, name)) invalidArguments(`${path}.${name} is required.`);
      return [name, parseSchemaValue(childSchema, record[name], `${path}.${name}`)];
    })
  );
  return Object.freeze(parsed);
}

export function parseToolArguments<S extends ToolObjectSchema>(
  schema: S,
  value: unknown
): ToolSchemaValue<S> {
  return parseSchemaValue(schema, value, 'arguments') as ToolSchemaValue<S>;
}
