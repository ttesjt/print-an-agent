import { describe, expectTypeOf, it } from 'vitest';
import type { ToolObjectSchema, ToolSchemaValue } from '../../../src/index.js';

const OPTIONAL_PARAMETERS = {
  type: 'object',
  properties: { optional: { type: 'string' } },
  required: [],
  additionalProperties: false,
} as const satisfies ToolObjectSchema;

const MIXED_PARAMETERS = {
  ...OPTIONAL_PARAMETERS,
  properties: { ...OPTIONAL_PARAMETERS.properties, required: { type: 'string' } },
  required: ['required'],
} as const satisfies ToolObjectSchema;

const REQUIRED_PARAMETERS = {
  ...MIXED_PARAMETERS,
  required: ['required', 'optional'],
} as const satisfies ToolObjectSchema;

type OptionalArguments = ToolSchemaValue<typeof OPTIONAL_PARAMETERS>;
type MixedArguments = ToolSchemaValue<typeof MIXED_PARAMETERS>;
type RequiredArguments = ToolSchemaValue<typeof REQUIRED_PARAMETERS>;

// Materialize intersections for equality assertions without depending on the helper's layout.
type ObjectShape<T> = { [K in keyof T]: T[K] };

describe('tool schema argument types', () => {
  it('allows omitted optional fields and preserves readonly optional properties', () => {
    const omitted: OptionalArguments = {};
    const supplied: OptionalArguments = { optional: 'present' };

    expectTypeOf(omitted).toMatchTypeOf<OptionalArguments>();
    expectTypeOf(supplied.optional).toEqualTypeOf<string | undefined>();
    expectTypeOf<ObjectShape<OptionalArguments>>().toEqualTypeOf<Readonly<{ optional?: string }>>();
  });

  it('requires only the declared required fields', () => {
    const arguments_: MixedArguments = { required: 'present' };

    expectTypeOf(arguments_.required).toEqualTypeOf<string>();
    expectTypeOf(arguments_.optional).toEqualTypeOf<string | undefined>();
    expectTypeOf<Record<string, never>>().not.toMatchTypeOf<MixedArguments>();
    expectTypeOf<ObjectShape<MixedArguments>>().toEqualTypeOf<
      Readonly<{ required: string; optional?: string }>
    >();
  });

  it('preserves all-required object shapes', () => {
    expectTypeOf(REQUIRED_PARAMETERS).toMatchTypeOf<ToolObjectSchema>();
    expectTypeOf<ObjectShape<RequiredArguments>>().toEqualTypeOf<
      Readonly<{ required: string; optional: string }>
    >();
    expectTypeOf<{ required: string }>().not.toMatchTypeOf<RequiredArguments>();
  });

  it('rejects incorrect optional values and explicit undefined under exact optional types', () => {
    expectTypeOf<{ optional: number }>().not.toMatchTypeOf<OptionalArguments>();
    expectTypeOf<{ optional: undefined }>().not.toMatchTypeOf<OptionalArguments>();
    expectTypeOf<{ required: number }>().not.toMatchTypeOf<MixedArguments>();
  });

  it('applies requiredness recursively through objects and readonly arrays', () => {
    const parameters = {
      ...OPTIONAL_PARAMETERS,
      properties: {
        items: { type: 'array', items: MIXED_PARAMETERS },
        details: MIXED_PARAMETERS,
      },
      required: ['items'],
    } as const satisfies ToolObjectSchema;
    type Arguments = ToolSchemaValue<typeof parameters>;

    expectTypeOf(parameters).toMatchTypeOf<ToolObjectSchema>();
    const arguments_: Arguments = { items: [{ required: 'present' }] };
    expectTypeOf(arguments_.items).toEqualTypeOf<readonly MixedArguments[]>();
    expectTypeOf(arguments_.details).toEqualTypeOf<MixedArguments | undefined>();
    expectTypeOf<{ items: readonly { optional: string }[] }>().not.toMatchTypeOf<Arguments>();
    expectTypeOf<{
      items: readonly [];
      details: Record<string, never>;
    }>().not.toMatchTypeOf<Arguments>();
    expectTypeOf<ObjectShape<Arguments>>().toEqualTypeOf<
      Readonly<{ items: readonly MixedArguments[]; details?: MixedArguments }>
    >();
  });
});
