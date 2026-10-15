import type { WorkflowFailureClassifier } from '../types/events.js';

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export function classifyFailureCode(
  classify: WorkflowFailureClassifier | undefined,
  error: unknown
): string | undefined {
  try {
    const code: unknown = classify?.(error);
    if (typeof code === 'string') return ERROR_CODE_PATTERN.test(code) ? code : undefined;
    // JavaScript callers may accidentally provide an async classifier. Never await it or
    // accept its eventual value, but observe rejection so it cannot escape as unhandled.
    if (code !== undefined) void Promise.resolve(code).catch(() => undefined);
  } catch {
    // Classification is diagnostic only; preserve the execution failure unchanged.
  }
  return undefined;
}
