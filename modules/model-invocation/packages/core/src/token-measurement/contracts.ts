export const TOKEN_MEASUREMENT_ACCURACY = Object.freeze({
  EXACT: 'exact',
  ESTIMATED: 'estimated',
} as const);
export type TokenMeasurementAccuracy =
  (typeof TOKEN_MEASUREMENT_ACCURACY)[keyof typeof TOKEN_MEASUREMENT_ACCURACY];

export const TOKEN_MEASUREMENT_SCOPE = Object.freeze({
  TEXT: 'text',
  CONTENT: 'content',
  REQUEST: 'request',
} as const);
export type TokenMeasurementScope =
  (typeof TOKEN_MEASUREMENT_SCOPE)[keyof typeof TOKEN_MEASUREMENT_SCOPE];

export const TOKEN_INPUT_KIND = Object.freeze({ TEXT: 'text' } as const);

export interface TokenMeasurementInput {
  readonly kind: string;
}

export interface TextTokenInput extends TokenMeasurementInput {
  readonly kind: typeof TOKEN_INPUT_KIND.TEXT;
  readonly text: string;
}

/** A borrowed synchronous parser; it must produce a stable view for this invocation. */
export interface TokenInputContract<TInput extends TokenMeasurementInput> {
  readonly ref: string;
  readonly scope: TokenMeasurementScope;
  readonly inputKinds: readonly TInput['kind'][];
  readonly parse: (input: unknown) => TInput;
}

export interface TokenCounterDescriptor {
  /** Distinguishes implementation, vocabulary/version and all counting options. */
  readonly measurementRef: string;
  readonly inputProtocolRef: string;
  readonly scope: TokenMeasurementScope;
  readonly inputKinds: readonly string[];
}

/** Exactness applies only to the bound protocol, scope and measurement identity. */
export interface TokenCountResult {
  readonly tokens: number;
  readonly accuracy: TokenMeasurementAccuracy;
}

export interface TokenMeasurement extends TokenCountResult {
  readonly measurementRef: string;
  readonly inputProtocolRef: string;
  readonly scope: TokenMeasurementScope;
}

export interface TokenCounterDefinition<TInput extends TokenMeasurementInput> {
  readonly measurementRef: string;
  readonly inputContract: TokenInputContract<TInput>;
  /** No implicit retry or serialization; shared implementations must isolate concurrent calls. */
  readonly measure: (input: TInput, signal: AbortSignal) => Promise<TokenCountResult>;
}

export interface TokenCounter<TInput extends TokenMeasurementInput> {
  readonly descriptor: TokenCounterDescriptor;
  // A function property keeps a text-only counter from widening to arbitrary input kinds.
  readonly measure: (input: TInput, signal: AbortSignal) => Promise<TokenMeasurement>;
}

/** Specified fields require equality; there is no implicit accuracy or scope conversion. */
export interface TokenMeasurementRequirements {
  readonly measurementRef?: string;
  readonly inputProtocolRef?: string;
  readonly scope?: TokenMeasurementScope;
  readonly accuracy?: TokenMeasurementAccuracy;
}
