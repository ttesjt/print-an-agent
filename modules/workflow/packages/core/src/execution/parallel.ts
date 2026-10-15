import { combineFailures } from './failures.js';
import { ExecutionScope } from './scope.js';

export async function runParallel<N extends string>(
  parent: ExecutionScope,
  names: readonly N[],
  runStep: (scope: ExecutionScope, name: N) => Promise<void>
): Promise<void> {
  const group = new ExecutionScope(parent.signal);
  group.assertAdmission();
  const failures: unknown[] = [];
  const calls = names.map((name) =>
    runStep(group, name).catch((error: unknown) => {
      failures.push(error);
      group.close();
      group.cancel(error);
    })
  );
  await Promise.all(calls);
  group.close();
  failures.push(...(await group.drain()));
  // Child outcomes, not a late signal check, determine whether the group succeeded.
  if (failures.length !== 0) throw combineFailures(failures);
}
