import type {
  DefineToolInput,
  ToolDefinition,
  ToolExecutionRequest,
  ToolName,
} from './contracts.js';
import type {
  ToolObjectSchema,
  ToolSchemaValue,
  ToolValueSchema,
} from '@ta-agent/model-invocation-core';
import { AgentToolError } from './errors.js';

const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const TOOL_DESCRIPTION_MAX_LENGTH = 1_024;
const SCHEMA_MAX_DEPTH = 8;
const SCHEMA_MAX_PROPERTIES = 64;

export function parseToolName(value: unknown): ToolName {
  if (
    typeof value !== 'string' ||
    value.length > TOOL_NAME_MAX_LENGTH ||
    !TOOL_NAME_PATTERN.test(value)
  ) {
    throw new AgentToolError(
      'TOOL_DEFINITION_INVALID',
      `Tool name must contain 1-${TOOL_NAME_MAX_LENGTH} letters, digits, underscores, or hyphens and start with a letter.`
    );
  }
  return value as ToolName;
}

function validateFiniteBound(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new AgentToolError('TOOL_SCHEMA_INVALID', `${name} must be finite.`);
  }
}

function validateSchema(schema: ToolValueSchema, depth: number): void {
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

function freezeSchema<S extends ToolValueSchema>(schema: S): S;
function freezeSchema(schema: ToolValueSchema): ToolValueSchema {
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

export function defineTool<const S extends ToolObjectSchema>(
  input: DefineToolInput<S>
): ToolDefinition<S> {
  const name = parseToolName(input.name);
  if (
    typeof input.description !== 'string' ||
    input.description.trim().length === 0 ||
    input.description.length > TOOL_DESCRIPTION_MAX_LENGTH
  ) {
    throw new AgentToolError(
      'TOOL_DEFINITION_INVALID',
      `Tool description must contain 1-${TOOL_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  validateSchema(input.parameters, 0);
  return Object.freeze({
    name,
    description: input.description,
    parameters: freezeSchema(input.parameters),
    execute: (request: ToolExecutionRequest<ToolSchemaValue<S>>) => input.execute(request),
  });
}

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
