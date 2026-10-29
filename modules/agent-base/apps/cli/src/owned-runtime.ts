import type { AgentBaseCliRuntime } from './contracts.js';
import { AgentBaseCliError } from './errors.js';

/** The caller waits for execution to settle before releasing its explicit host-owned setup. */
export async function withCliRuntime<T>(
  runtime: AgentBaseCliRuntime,
  execute: (runtime: AgentBaseCliRuntime) => Promise<T>
): Promise<T> {
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await execute(runtime) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await runtime.close?.();
  } catch (cleanup) {
    throw new AgentBaseCliError(
      'CLI_RESOURCE_CLEANUP_FAILED',
      'CLI runtime cleanup could not be confirmed.',
      { cause: { operation: outcome, cleanup } }
    );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
