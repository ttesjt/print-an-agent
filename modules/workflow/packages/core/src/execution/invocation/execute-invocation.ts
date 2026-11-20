import type { Step, StepExecutor } from '../../contracts/index.js';
import { combineFailures } from '../failures.js';
import { ExecutionScope, runInScope } from '../scope/index.js';

export async function executeInvocation<N extends string, C>(options: {
  name: N;
  context: C;
  step: Step<C>;
  executor: StepExecutor<N, C>;
  scope: ExecutionScope;
  createContext: (scope: ExecutionScope) => C;
  incomplete: () => Error;
  violate: (message: string) => Error;
}): Promise<void> {
  const attempts = new ExecutionScope(options.scope.signal);
  let calls = 0;
  const step: Step<C> = (context) => {
    try {
      if (!attempts.open || attempts.pending || context !== options.context) {
        throw options.violate('Executor must await serial attempts with its supplied context.');
      }
      attempts.assertAdmission();
      calls++;
      return attempts.track(async () => {
        const scope = new ExecutionScope(options.scope.signal);
        scope.assertAdmission();
        await runInScope(
          scope,
          () => options.step(options.createContext(scope)),
          options.incomplete
        );
      });
    } catch (error) {
      const rejected = Promise.resolve().then(() => {
        throw error;
      });
      void rejected.catch(() => undefined);
      return rejected;
    }
  };

  const failures: unknown[] = [];
  try {
    await options.executor({ stepName: options.name, step, context: options.context });
    if (calls === 0) failures.push(options.violate('Executor did not invoke its Step.'));
    if (attempts.pending)
      failures.push(options.violate('Executor returned with unfinished attempts.'));
  } catch (error) {
    failures.push(error);
  }
  attempts.close();
  if (failures.length !== 0) {
    options.scope.close();
    options.scope.cancel(failures[0]);
  }
  failures.push(...(await attempts.drain()));
  if (failures.length !== 0) throw combineFailures(failures);
}
