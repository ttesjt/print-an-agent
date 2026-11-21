const TRACE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export function isTraceErrorCode(value: unknown): value is string {
  return typeof value === 'string' && TRACE_ERROR_CODE_PATTERN.test(value);
}

export function traceErrorCode(error: unknown): string {
  if (error instanceof AggregateError && error.cause !== undefined) {
    return traceErrorCode(error.cause);
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (isTraceErrorCode(code)) return code;
  }
  return 'UNEXPECTED_ERROR';
}
