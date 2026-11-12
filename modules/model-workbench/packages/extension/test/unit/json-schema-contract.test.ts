import { describe, expect, it } from 'vitest';

import { InvalidWorkbenchValueError } from '@print-an-agent/workbench-domain';

import {
  JsonSchemaContractValidator,
  JsonSchemaDialect,
  WorkbenchExtensionError,
  defineJsonSchemaContract,
} from '../../src/index.js';

describe('defineJsonSchemaContract', () => {
  it('compiles Draft 2020-12 schema into one evidence-backed runtime parser', () => {
    const contract = defineJsonSchemaContract({
      schema: {
        $schema: JsonSchemaDialect.Draft202012,
        type: 'object',
        required: ['source'],
        properties: { source: { type: 'string' } },
        additionalProperties: false,
      } as const,
    });

    const parsed = contract.parse({ source: 'fixture://base' }, 'input');

    expect(parsed.source).toBe('fixture://base');
    expect(contract.evidence).toEqual({
      contract: 'json-schema',
      dialect: JsonSchemaDialect.Draft202012,
      schema: {
        $schema: JsonSchemaDialect.Draft202012,
        additionalProperties: false,
        properties: { source: { type: 'string' } },
        required: ['source'],
        type: 'object',
      },
      validator: {
        engine: JsonSchemaContractValidator.Engine,
        version: JsonSchemaContractValidator.Version,
      },
    });
  });

  it('rejects a value that does not satisfy the configured schema', () => {
    const contract = defineJsonSchemaContract({
      schema: {
        $schema: JsonSchemaDialect.Draft202012,
        type: 'object',
        required: ['source'],
        properties: { source: { type: 'string' } },
      } as const,
    });

    expect(() => contract.parse({ source: 42 }, 'input')).toThrow(InvalidWorkbenchValueError);
    expect(() => contract.parse({ source: 42 }, 'input')).toThrow('must be string at "/source"');
  });

  it('rejects a schema that declares a different dialect', () => {
    expect(() =>
      defineJsonSchemaContract({
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'string',
        } as const,
      })
    ).toThrow(WorkbenchExtensionError);
  });
});
