import {
  supportsSessionExecution,
  type SessionExecutionLease,
  type SessionReference,
} from '@print-an-agent/base-session';

/** Existing storage fixtures explicitly acquire authority; lifecycle tests use raw ports directly. */
export async function sessionWrite<const T extends SessionReference, R>(
  adapter: object,
  request: T,
  write: (input: T & { readonly execution: SessionExecutionLease }) => Promise<R>
): Promise<R> {
  if (!supportsSessionExecution(adapter)) throw new Error('Fixture requires execution capability.');
  const execution = await adapter.acquireSessionExecution(request);
  try {
    return await write({ ...request, execution });
  } finally {
    await adapter.releaseSessionExecution(execution);
  }
}
