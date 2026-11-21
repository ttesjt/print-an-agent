import type { TokenMeasurementScope } from '../options.js';
import type { TokenMeasurementInput, TokenInputContract } from './input.js';
import type { TokenCountResult, TokenMeasurement } from './measurement.js';

export interface TokenCounterDescriptor {
  /** Distinguishes implementation, vocabulary/version and all counting options. */
  readonly measurementRef: string;
  readonly inputProtocolRef: string;
  readonly scope: TokenMeasurementScope;
  readonly inputKinds: readonly string[];
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
