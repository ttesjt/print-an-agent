import { invalidTraceEvent } from '../../errors.js';

export type TraceField<Value = unknown> = (value: unknown, name: string) => Value;
export type TraceFields = Readonly<Record<string, TraceField>>;
export type TraceFieldValues<Fields extends TraceFields> = {
  readonly [Key in keyof Fields]: ReturnType<Fields[Key]>;
};

export interface TraceEventSchema<
  Type extends string = string,
  Fields extends TraceFields = TraceFields,
  OptionalFields extends TraceFields = TraceFields,
> {
  readonly type: Type;
  readonly fields: Fields;
  readonly optionalFields: OptionalFields | undefined;
}

export type TraceEventDetailsOf<Schema extends TraceEventSchema> =
  Schema extends TraceEventSchema<infer Type, infer Fields, infer OptionalFields>
    ? Readonly<{ type: Type }> &
        TraceFieldValues<Fields> &
        Partial<TraceFieldValues<OptionalFields>>
    : never;

/** One field definition owns both its runtime rule and its inferred metadata type. */
export function traceEvent<
  const Type extends string,
  Fields extends TraceFields,
  OptionalFields extends TraceFields = Record<never, never>,
>(
  type: Type,
  fields: Fields,
  optionalFields?: OptionalFields
): TraceEventSchema<Type, Fields, OptionalFields> {
  return { type, fields, optionalFields };
}

export function validateTraceEventSchema(
  record: Readonly<Record<string, unknown>>,
  schema: TraceEventSchema,
  envelopeFields: TraceFields
): void {
  const required = { ...schema.fields, ...envelopeFields };
  const optional = schema.optionalFields ?? {};
  for (const key of Object.keys(record)) {
    if (key !== 'type' && !Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) {
      invalidTraceEvent('Trace event contains unknown or contradictory fields.');
    }
  }
  for (const [key, validate] of Object.entries(required)) {
    if (!Object.hasOwn(record, key)) invalidTraceEvent(`Trace ${key} is required.`);
    validate(record[key], `Trace ${key}`);
  }
  for (const [key, validate] of Object.entries(optional)) {
    if (Object.hasOwn(record, key)) validate(record[key], `Trace ${key}`);
  }
}
