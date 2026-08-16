import {
  InvalidWorkbenchValueError,
  parseJsonValue,
  type JsonObject,
  type JsonValue,
} from '@ta-agent/workbench-domain';
import type { Static } from 'typebox';
import Schema, { type Validator } from 'typebox/schema';

import type { ExtensionValueContract } from '../extension-value-contract.js';
import { invalidExtension, parseDomainValue } from '../../foundation/validation.js';
import { JsonSchemaContractValidator, JsonSchemaDialect } from './constants.js';

export type JsonSchemaDocument = boolean | JsonObject;

export interface JsonSchemaContractInput<TSchema extends JsonSchemaDocument> {
  readonly schema: TSchema;
}

export function defineJsonSchemaContract<const TSchema extends JsonSchemaDocument>(
  input: JsonSchemaContractInput<TSchema>
): ExtensionValueContract<Static<TSchema>> {
  const schema = parseJsonSchema(input.schema);
  const validator = compileValidator(input.schema);
  const evidence = parseJsonValue({
    contract: 'json-schema',
    dialect: JsonSchemaDialect.Draft202012,
    schema,
    validator: {
      engine: JsonSchemaContractValidator.Engine,
      version: JsonSchemaContractValidator.Version,
    },
  });

  return Object.freeze({
    evidence,
    parse(value: unknown, path: string): Static<TSchema> {
      const json = parseJsonValue(value, path);
      if (!validator.Check(json)) {
        const [, errors] = validator.Errors(json);
        const first = errors[0];
        const location = first?.instancePath === undefined ? '' : ` at "${first.instancePath}"`;
        const reason = first?.message ?? 'does not satisfy the configured JSON Schema';
        throw new InvalidWorkbenchValueError(path, `${reason}${location}`);
      }
      return json;
    },
  });
}

function parseJsonSchema(input: unknown): JsonSchemaDocument {
  const schema = parseDomainValue(
    () => parseJsonValue(input, 'jsonSchemaContract.schema'),
    'jsonSchemaContract.schema'
  );
  if (typeof schema === 'boolean') return schema;
  if (!isJsonObject(schema)) {
    invalidExtension('jsonSchemaContract.schema', 'must be an object or boolean JSON Schema');
  }
  const declaredDialect = schema.$schema;
  if (declaredDialect !== undefined && declaredDialect !== JsonSchemaDialect.Draft202012) {
    invalidExtension(
      'jsonSchemaContract.schema.$schema',
      `must equal ${JsonSchemaDialect.Draft202012}`
    );
  }
  return schema;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compileValidator<TSchema extends JsonSchemaDocument>(schema: TSchema): Validator<TSchema> {
  try {
    return Schema.Compile(schema);
  } catch (cause: unknown) {
    return invalidExtension('jsonSchemaContract.schema', 'could not be compiled', { cause });
  }
}
