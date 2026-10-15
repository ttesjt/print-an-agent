import { combineFailures } from './failures.js';
import type { ExecutionScope } from './scope.js';

/** Close admission at the actual body boundary, not after an outer executor's post-processing. */
export async function runInScope(
  scope: ExecutionScope,
  work: () => Promise<void>,
  incomplete: () => Error
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await work();
  } catch (error) {
    failures.push(error);
  }
  scope.close();
  if (scope.pending) {
    if (failures.length === 0) failures.push(incomplete());
    scope.cancel(failures[0]);
    failures.push(...(await scope.drain()));
  }
  if (failures.length !== 0) throw combineFailures(failures);
}
