import type { StepRunner, Step } from '../contracts/index.js';

export function createSequentialStep<N extends string, C extends Pick<StepRunner<N>, 'runStep'>>(
  names: readonly N[]
): Step<C> {
  const snapshot = [...names];
  return async (context) => {
    for (const name of snapshot) await context.runStep(name);
  };
}
