export const JsonSchemaDialect = {
  Draft202012: 'https://json-schema.org/draft/2020-12/schema',
} as const;

export type JsonSchemaDialect = (typeof JsonSchemaDialect)[keyof typeof JsonSchemaDialect];

export const JsonSchemaContractValidator = {
  Engine: 'typebox/schema',
  Version: '1.1.38',
} as const;
