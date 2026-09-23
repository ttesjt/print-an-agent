import { supportsSessionExecution, type SessionExecutionLease } from './execution.js';

export interface SessionExecutionContext {
  readonly resources: { readonly session: object };
  execution?: SessionExecutionLease;
}

/** Failed cleanup retains occupancy for explicit recovery rather than claiming settlement. */
export async function finalizeSessionExecution<C extends SessionExecutionContext>(
  context: C,
  cleanup?: (context: C) => Promise<void>
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await cleanup?.(context);
  } catch (error: unknown) {
    errors.push(error);
  }
  try {
    if (
      errors.length === 0 &&
      context.execution !== undefined &&
      supportsSessionExecution(context.resources.session)
    ) {
      await context.resources.session.releaseSessionExecution(context.execution);
    }
  } catch (error: unknown) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Session execution cleanup failed.');
}
