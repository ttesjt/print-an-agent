import type { WorkflowContext } from '../types/context.js';
import type { WorkflowEventReference } from '../types/events.js';
import type { ExecutionScope } from './scope.js';

export interface RunData<S, R, O> {
  readonly resources: R;
  readonly state: S;
  result: O;
}

export function createContext<N extends string, S, R, O>(
  data: RunData<S, R, O>,
  reference: WorkflowEventReference,
  scope: ExecutionScope,
  runStep: (name: N) => Promise<void>,
  parallel: (names: readonly N[]) => Promise<void>
): WorkflowContext<N, S, R, O> {
  return Object.freeze({
    ...reference,
    resources: data.resources,
    state: data.state,
    signal: scope.signal,
    runStep,
    parallel,
    get result(): O {
      return data.result;
    },
    set result(value: O) {
      data.result = value;
    },
  });
}
