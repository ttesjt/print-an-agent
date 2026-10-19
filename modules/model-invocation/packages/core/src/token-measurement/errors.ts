const ERROR_CODES = Object.freeze([
  'TOKEN_MEASUREMENT_BINDING_INVALID',
  'TOKEN_MEASUREMENT_INPUT_INVALID',
  'TOKEN_MEASUREMENT_INPUT_UNSUPPORTED',
  'TOKEN_MEASUREMENT_RESULT_INVALID',
  'TOKEN_MEASUREMENT_FAILED',
  'TOKEN_MEASUREMENT_REQUIREMENT_INVALID',
  'TOKEN_MEASUREMENT_REQUIREMENT_UNSATISFIED',
] as const);
export type TokenMeasurementErrorCode = (typeof ERROR_CODES)[number];

export class TokenMeasurementError extends Error {
  readonly code: TokenMeasurementErrorCode;

  constructor(code: TokenMeasurementErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TokenMeasurementError';
    this.code = code;
  }
}

/** Catch boundaries must not execute a thrown value's code getter or fail on a revoked Proxy. */
export function hasMeasurementErrorCode(
  cause: unknown,
  expected: readonly TokenMeasurementErrorCode[] = ERROR_CODES
): boolean {
  try {
    if (!(cause instanceof TokenMeasurementError)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(cause, 'code');
    if (descriptor === undefined || !('value' in descriptor)) return false;
    const value: unknown = descriptor.value;
    return expected.some((code) => code === value);
  } catch {
    return false;
  }
}
