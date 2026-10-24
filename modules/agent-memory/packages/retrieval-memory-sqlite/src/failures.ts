import type { FailureDetail } from './protocol.js';
/** Private diagnostics only. Preserve independent failures without exposing them in public messages. */
export function failureDetails(cause: unknown): readonly FailureDetail[] {
  if (!(cause instanceof Error)) return [];
  const details = [{ name: cause.name, message: cause.message }];
  if (cause instanceof AggregateError)
    for (const child of cause.errors as readonly unknown[]) details.push(...failureDetails(child));
  else if (cause.cause !== undefined) details.push(...failureDetails(cause.cause));
  return details;
}
export function restoreFailures(details: readonly FailureDetail[]): Error | undefined {
  if (details.length === 0) return undefined;
  return new AggregateError(
    details.map((detail) => Object.assign(new Error(detail.message), { name: detail.name })),
    'SQLite worker private diagnostics.'
  );
}
