import type { WorkflowContext, WorkflowInputs } from '../types/context.js';
import type { WorkflowEventReference } from '../types/events.js';
import type { ExecutionScope } from './scope.js';

export interface RunData<I, S, R, O> extends WorkflowInputs<I, R> {
  readonly state: S;
  result: O;
}

export function createContext<N extends string, I, S, R, O>(
  data: RunData<I, S, R, O>,
  reference: WorkflowEventReference,
  scope: ExecutionScope,
  runStep: (name: N) => Promise<void>,
  parallel: (names: readonly N[]) => Promise<void>
): WorkflowContext<N, I, S, R, O> {
  return Object.freeze({
    ...reference,
    input: data.input,
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
