import type { FailureDetail } from './types.js';
/** Private diagnostics only. Preserve independent failures without exposing them in public messages. */
export function failureDetails(cause: unknown): readonly FailureDetail[] {
  if (!(cause instanceof Error)) return [];
  const details: FailureDetail[] = [
    {
      name: cause.name,
      message: cause.message,
      ...(cause.stack === undefined ? {} : { stack: cause.stack }),
    },
  ];
  if (cause instanceof AggregateError)
    for (const child of cause.errors as readonly unknown[]) details.push(...failureDetails(child));
  else if (cause.cause !== undefined) details.push(...failureDetails(cause.cause));
  return details;
}
export function restoreFailures(details: readonly FailureDetail[]): Error | undefined {
  if (details.length === 0) return undefined;
  return new AggregateError(
    details.map((detail) =>
      Object.assign(new Error(detail.message), {
        name: detail.name,
        ...(detail.stack === undefined ? {} : { stack: detail.stack }),
      })
    ),
    'SQLite worker private diagnostics.'
  );
}
