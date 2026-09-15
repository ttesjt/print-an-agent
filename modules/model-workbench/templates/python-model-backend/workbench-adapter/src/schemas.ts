import { JsonSchemaDialect } from '@ta-agent/workbench-extension';

import { PythonModelBackendDType, PythonModelBackendDevice } from './constants.js';

const SchemaType = {
  Boolean: 'boolean',
  Integer: 'integer',
  Number: 'number',
  Object: 'object',
  String: 'string',
} as const;

const Limits = {
  ContextLength: { Minimum: 2, Maximum: 32 },
  EmbeddingDimension: { Minimum: 4, Maximum: 256 },
  AttentionHeads: { Minimum: 1, Maximum: 16 },
  Layers: { Minimum: 1, Maximum: 8 },
  FeedForwardMultiplier: { Minimum: 1, Maximum: 8 },
  Seed: { Minimum: 0, Maximum: 2_147_483_647 },
  TrainingSteps: { Minimum: 1, Maximum: 100_000 },
  BatchSize: { Minimum: 1, Maximum: 1_024 },
  LearningRate: { ExclusiveMinimum: 0, Maximum: 1 },
  NewTokens: { Minimum: 1, Maximum: 1_024 },
} as const;

export const TinyTransformerOutputFormat = 'ta-agent.tiny-transformer-output';

const ModelConfigurationSchema = {
  type: SchemaType.Object,
  properties: {
    contextLength: {
      type: SchemaType.Integer,
      minimum: Limits.ContextLength.Minimum,
      maximum: Limits.ContextLength.Maximum,
    },
    embeddingDimension: {
      type: SchemaType.Integer,
      minimum: Limits.EmbeddingDimension.Minimum,
      maximum: Limits.EmbeddingDimension.Maximum,
    },
    attentionHeads: {
      type: SchemaType.Integer,
      minimum: Limits.AttentionHeads.Minimum,
      maximum: Limits.AttentionHeads.Maximum,
    },
    layers: {
      type: SchemaType.Integer,
      minimum: Limits.Layers.Minimum,
      maximum: Limits.Layers.Maximum,
    },
    feedForwardMultiplier: {
      type: SchemaType.Integer,
      minimum: Limits.FeedForwardMultiplier.Minimum,
      maximum: Limits.FeedForwardMultiplier.Maximum,
    },
  },
  required: [
    'contextLength',
    'embeddingDimension',
    'attentionHeads',
    'layers',
    'feedForwardMultiplier',
  ],
  additionalProperties: false,
} as const;

const SeedSchema = {
  type: SchemaType.Integer,
  minimum: Limits.Seed.Minimum,
  maximum: Limits.Seed.Maximum,
} as const;

const LossSchema = { type: SchemaType.Number, minimum: 0 } as const;

const RuntimeEvidenceProperties = {
  device: {
    type: SchemaType.String,
    enum: Object.values(PythonModelBackendDevice),
  },
  dtype: {
    type: SchemaType.String,
    enum: Object.values(PythonModelBackendDType),
  },
} as const;

export const InitializationInputSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    model: ModelConfigurationSchema,
    seed: SeedSchema,
  },
  required: ['model', 'seed'],
  additionalProperties: false,
} as const;

export const InitializationResultDataSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    parameterCount: { type: SchemaType.Integer, minimum: 1 },
    ...RuntimeEvidenceProperties,
  },
  required: ['parameterCount', 'device', 'dtype'],
  additionalProperties: false,
} as const;

export const TrainingInputSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    steps: {
      type: SchemaType.Integer,
      minimum: Limits.TrainingSteps.Minimum,
      maximum: Limits.TrainingSteps.Maximum,
    },
    batchSize: {
      type: SchemaType.Integer,
      minimum: Limits.BatchSize.Minimum,
      maximum: Limits.BatchSize.Maximum,
    },
    learningRate: {
      type: SchemaType.Number,
      exclusiveMinimum: Limits.LearningRate.ExclusiveMinimum,
      maximum: Limits.LearningRate.Maximum,
    },
    seed: SeedSchema,
  },
  required: ['steps', 'batchSize', 'learningRate', 'seed'],
  additionalProperties: false,
} as const;

export const TrainingResultDataSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    steps: { type: SchemaType.Integer, minimum: 1 },
    initialLoss: LossSchema,
    finalLoss: LossSchema,
  },
  required: ['steps', 'initialLoss', 'finalLoss'],
  additionalProperties: false,
} as const;

export const ExportInputSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    format: { const: TinyTransformerOutputFormat },
  },
  required: ['format'],
  additionalProperties: false,
} as const;

export const ExportResultDataSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    format: { const: TinyTransformerOutputFormat },
    parameterCount: { type: SchemaType.Integer, minimum: 1 },
  },
  required: ['format', 'parameterCount'],
  additionalProperties: false,
} as const;

export const InvocationInputSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    prompt: { type: SchemaType.String, minLength: 1 },
    maxNewTokens: {
      type: SchemaType.Integer,
      minimum: Limits.NewTokens.Minimum,
      maximum: Limits.NewTokens.Maximum,
    },
    stream: { type: SchemaType.Boolean },
  },
  required: ['prompt', 'maxNewTokens', 'stream'],
  additionalProperties: false,
} as const;

export const InvocationOutputSchema = {
  $schema: JsonSchemaDialect.Draft202012,
  type: SchemaType.Object,
  properties: {
    text: { type: SchemaType.String, minLength: 1 },
  },
  required: ['text'],
  additionalProperties: false,
} as const;
