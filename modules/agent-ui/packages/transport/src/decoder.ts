/** Closed JSON codecs for the optional Agent UI transport boundary. */
export class TransportProtocolError extends Error {
  readonly code = 'WEB_TRANSPORT_INVALID';
  constructor() {
    super('The application transport payload is invalid.');
  }
}
export interface Decoder<T> {
  readonly decode: (input: unknown) => T;
}
interface OptionalDecoder<T> extends Decoder<T | undefined> {
  readonly optional: true;
}
type Decoded<T> = T extends Decoder<infer Value> ? Value : never;
type Fields = Readonly<Record<string, Decoder<unknown>>>;
type ObjectValue<S extends Fields> = {
  [K in keyof S as S[K] extends OptionalDecoder<unknown> ? never : K]: Decoded<S[K]>;
} & {
  [K in keyof S as S[K] extends OptionalDecoder<unknown> ? K : never]?: Exclude<
    Decoded<S[K]>,
    undefined
  >;
};

export function fail(): never {
  throw new TransportProtocolError();
}
export function literal<const T extends string | boolean | null>(value: T): Decoder<T> {
  return { decode: (input) => (input === value ? value : fail()) };
}
export function text(maxLength = 1_000_000, minimum = 0): Decoder<string> {
  return {
    decode: (input) =>
      typeof input === 'string' && input.length >= minimum && input.length <= maxLength
        ? input
        : fail(),
  };
}
export function integer(minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Decoder<number> {
  return {
    decode: (input) =>
      typeof input === 'number' &&
      Number.isSafeInteger(input) &&
      input >= minimum &&
      input <= maximum
        ? input
        : fail(),
  };
}
export function optional<T>(decoder: Decoder<T>): OptionalDecoder<T> {
  return {
    optional: true,
    decode: (input) => (input === undefined ? undefined : decoder.decode(input)),
  };
}
export function array<T>(decoder: Decoder<T>, maximum = 10_000): Decoder<readonly T[]> {
  return {
    decode: (input) =>
      Array.isArray(input) && input.length <= maximum
        ? input.map((item: unknown) => decoder.decode(item))
        : fail(),
  };
}
export function union<const D extends readonly Decoder<unknown>[]>(
  ...decoders: D
): Decoder<Decoded<D[number]>> {
  return {
    decode: (input) => {
      for (const decoder of decoders) {
        try {
          return decoder.decode(input) as Decoded<D[number]>;
        } catch (error) {
          if (!(error instanceof TransportProtocolError)) throw error;
        }
      }
      return fail();
    },
  };
}
export function object<const S extends Fields>(fields: S): Decoder<ObjectValue<S>> {
  return {
    decode: (input) => {
      if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype
      )
        return fail();
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (
        Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !Object.hasOwn(fields, key))
      )
        return fail();
      const normalized: Record<string, unknown> = {};
      for (const [key, decoder] of Object.entries(fields)) {
        const descriptor = descriptors[key];
        if (descriptor === undefined && !('optional' in decoder)) return fail();
        if (
          descriptor !== undefined &&
          (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        )
          return fail();
        const value: unknown = descriptor?.value;
        const parsed = decoder.decode(value);
        if (parsed !== undefined || !('optional' in decoder)) normalized[key] = parsed;
      }
      // Every declared field was reconstructed by its own decoder, and extra fields were rejected.
      return normalized as ObjectValue<S>;
    },
  };
}
