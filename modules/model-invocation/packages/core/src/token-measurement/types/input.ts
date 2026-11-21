import type { TokenMeasurementScope } from '../options.js';

export interface TokenMeasurementInput {
  readonly kind: string;
}

/** A borrowed synchronous parser; it must produce a stable view for this invocation. */
export interface TokenInputContract<TInput extends TokenMeasurementInput> {
  readonly ref: string;
  readonly scope: TokenMeasurementScope;
  readonly inputKinds: readonly TInput['kind'][];
  readonly parse: (input: unknown) => TInput;
}
