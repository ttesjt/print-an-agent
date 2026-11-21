import { parseToolName } from '@print-an-agent/base-tool';
import {
  type ToolDescriptor,
  type ToolObjectSchema,
  type ToolValueSchema,
} from '@print-an-agent/model-invocation-core';
import {
  assertKeys,
  invalidRecord,
  optionalFiniteNumber,
  optionalNonNegativeInteger,
  requireRecord,
  requireString,
} from './validation.js';
const TOOL_SCHEMA_MAX_DEPTH = 8;

const TOOL_SCHEMA_MAX_PROPERTIES = 64;

const TOOL_DESCRIPTION_MAX_LENGTH = 1_024;

function decodeStringSchema(record: Record<string, unknown>): ToolValueSchema {
  assertKeys(record, ['type'], ['enum', 'maxLength', 'minLength'], 'Tool string schema');
  const minLength = optionalNonNegativeInteger(record.minLength, 'Tool string minLength');
  const maxLength = optionalNonNegativeInteger(record.maxLength, 'Tool string maxLength');
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw invalidRecord('Tool string schema length bounds contradict.');
  }
  let enumValues: readonly string[] | undefined;
  if (record.enum !== undefined) {
    if (!Array.isArray(record.enum) || record.enum.length === 0) {
      throw invalidRecord('Tool string enum must be a non-empty array.');
    }
    const values = record.enum.map((value) => requireString(value, 'Tool string enum value'));
    if (new Set(values).size !== values.length) {
      throw invalidRecord('Tool string enum values must be unique.');
    }
    enumValues = Object.freeze(values);
  }
  return Object.freeze({
    type: 'string',
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
  });
}

function decodeNumericSchema(
  record: Record<string, unknown>,
  type: 'number' | 'integer'
): ToolValueSchema {
  assertKeys(record, ['type'], ['maximum', 'minimum'], `Tool ${type} schema`);
  const minimum = optionalFiniteNumber(record.minimum, `Tool ${type} minimum`);
  const maximum = optionalFiniteNumber(record.maximum, `Tool ${type} maximum`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw invalidRecord(`Tool ${type} schema bounds contradict.`);
  }
  return Object.freeze({
    type,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function decodeObjectSchema(record: Record<string, unknown>, depth: number): ToolObjectSchema {
  assertKeys(
    record,
    ['additionalProperties', 'properties', 'required', 'type'],
    [],
    'Tool object schema'
  );
  if (record.additionalProperties !== false) {
    throw invalidRecord('Tool object schema must reject additional properties.');
  }
  const propertyRecord = requireRecord(record.properties, 'Tool schema properties');
  const propertyNames = Object.keys(propertyRecord);
  if (propertyNames.length > TOOL_SCHEMA_MAX_PROPERTIES) {
    throw invalidRecord(`Tool object schema exceeds ${TOOL_SCHEMA_MAX_PROPERTIES} properties.`);
  }
  const properties = Object.fromEntries(
    propertyNames.map((name) => [name, decodeToolSchema(propertyRecord[name], depth + 1)])
  );
  if (!Array.isArray(record.required)) {
    throw invalidRecord('Tool object required fields must be an array.');
  }
  const required = record.required.map((value) => requireString(value, 'Required property name'));
  if (
    required.length !== propertyNames.length ||
    new Set(required).size !== required.length ||
    required.some((name) => !Object.hasOwn(properties, name))
  ) {
    throw invalidRecord('Tool object schema must require every property exactly once.');
  }
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    required: Object.freeze(required),
    additionalProperties: false,
  });
}

function decodeToolSchema(value: unknown, depth: number): ToolValueSchema {
  if (depth > TOOL_SCHEMA_MAX_DEPTH) {
    throw invalidRecord(`Tool schema exceeds maximum depth ${TOOL_SCHEMA_MAX_DEPTH}.`);
  }
  const record = requireRecord(value, 'Tool schema');
  if (record.type === 'string') return decodeStringSchema(record);
  if (record.type === 'number' || record.type === 'integer') {
    return decodeNumericSchema(record, record.type);
  }
  if (record.type === 'boolean' || record.type === 'null') {
    assertKeys(record, ['type'], [], `Tool ${record.type} schema`);
    return Object.freeze({ type: record.type });
  }
  if (record.type === 'array') {
    assertKeys(record, ['items', 'type'], ['maxItems'], 'Tool array schema');
    const maxItems = optionalNonNegativeInteger(record.maxItems, 'Tool array maxItems');
    return Object.freeze({
      type: 'array',
      items: decodeToolSchema(record.items, depth + 1),
      ...(maxItems === undefined ? {} : { maxItems }),
    });
  }
  if (record.type === 'object') return decodeObjectSchema(record, depth);
  throw invalidRecord('Tool schema type is unsupported.');
}

export function decodeToolDescriptor(value: unknown): ToolDescriptor {
  const record = requireRecord(value, 'Tool descriptor');
  assertKeys(record, ['description', 'name', 'parameters'], [], 'Tool descriptor');
  const description = requireString(record.description, 'Tool description');
  if (description.trim().length === 0 || description.length > TOOL_DESCRIPTION_MAX_LENGTH) {
    throw invalidRecord(
      `Tool description must contain 1-${TOOL_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  let name;
  try {
    name = parseToolName(record.name);
  } catch (cause: unknown) {
    throw invalidRecord('Tool descriptor name is invalid.', cause);
  }
  const parameters = decodeToolSchema(record.parameters, 0);
  if (parameters.type !== 'object') {
    throw invalidRecord('Tool descriptor parameters must be an object schema.');
  }
  return Object.freeze({ name, description, parameters });
}
