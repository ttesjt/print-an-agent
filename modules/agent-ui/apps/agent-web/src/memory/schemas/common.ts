import {
  array,
  fail,
  integer,
  literal,
  object,
  optional,
  text,
  union,
  type Decoder,
} from '@ta-agent/ui-transport';
import type { MutationOutcome } from '@ta-agent/ui-contracts';

export type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
function json(input: unknown, depth = 0): Json {
  if (depth > 64) return fail();
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') return Number.isFinite(input) ? input : fail();
  if (typeof input === 'string') return input.isWellFormed() ? input : fail();
  if (Array.isArray(input)) return input.map((value: unknown) => json(value, depth + 1));
  if (typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return fail();
  const entries = Reflect.ownKeys(input).map((key) => {
    if (typeof key !== 'string' || !key.isWellFormed()) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
      return fail();
    return [key, json(descriptor.value, depth + 1)] as const;
  });
  return Object.fromEntries(entries);
}
export const metadata: Decoder<Readonly<Record<string, Json>>> = {
  decode: (input) => {
    const value = json(input);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    return value as Readonly<Record<string, Json>>;
  },
};
export function number(min = -Number.MAX_VALUE, max = Number.MAX_VALUE): Decoder<number> {
  return {
    decode: (input) =>
      typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max
        ? input
        : fail(),
  };
}
export const id: Decoder<string> = {
  decode: (input) => {
    const value = text(16384, 1).decode(input);
    return value.isWellFormed() && !value.includes('\0') && value.trim() !== '' ? value : fail();
  },
};
export const content: Decoder<string> = {
  decode: (input) => {
    const value = text().decode(input);
    return value.isWellFormed() ? value : fail();
  },
};
export const targetFields = { agentId: id, memoryId: id };
export const target = object(targetFields);
export const notice = object({ code: id, message: content });
export const failure = object({
  code: id,
  message: content,
  domainCode: optional(id),
  details: optional(
    object({
      actual: optional(integer()),
      limit: optional(integer()),
      expectedRevision: optional(integer()),
      actualRevision: optional(integer()),
      kind: optional(id),
      measurementRef: optional(id),
      rendererRef: optional(id),
    })
  ),
});
export const recovery = object({ ...targetFields, requestId: id });
export const measurementFields = {
  tokens: integer(),
  accuracy: union(literal('exact'), literal('estimated')),
  measurementRef: id,
  inputProtocolRef: id,
  scope: union(literal('text'), literal('content'), literal('request')),
};
export const measurement = object(measurementFields);
export const skipped = object({ status: literal('skipped'), target, reason: content });
export function query<T>(value: Decoder<T>) {
  return union(
    object({ status: literal('succeeded'), target, value, notices: optional(array(notice)) }),
    object({ status: literal('failed'), failure }),
    skipped
  );
}
type SharedMutation<T> = MutationOutcome<
  {
    readonly target: ReturnType<typeof target.decode>;
    readonly status: 'committed' | 'unchanged';
    readonly receipt: T;
  },
  MemoryFailure
>;
/** Shared commit outcome plus native Workflow skip and the identity needed for receipt recovery. */
export type MemoryMutationOutcome<T> =
  | Extract<SharedMutation<T>, { status: 'committed' | 'rejected' }>
  | (Extract<SharedMutation<T>, { status: 'indeterminate' }> & {
      readonly recovery: ReturnType<typeof recovery.decode>;
    })
  | ReturnType<typeof skipped.decode>;
export function mutation<T>(receipt: Decoder<T>): Decoder<MemoryMutationOutcome<T>> {
  return union(
    object({
      status: literal('committed'),
      value: object({ target, status: union(literal('committed'), literal('unchanged')), receipt }),
      notices: array(notice),
    }),
    object({ status: literal('rejected'), failure }),
    object({ status: literal('indeterminate'), notice, recovery }),
    skipped
  );
}
export type MemoryFailure = ReturnType<typeof failure.decode>;
