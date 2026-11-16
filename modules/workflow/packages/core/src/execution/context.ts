import type { WorkflowContext } from '../types/context.js';
import type { WorkflowEventReference } from '../types/events.js';
import type { ExecutionScope } from './scope.js';

export interface RunData<S, R> {
  readonly resources: R;
  readonly state: S;
}

export function createContext<N extends string, S, R>(
  data: RunData<S, R>,
  reference: WorkflowEventReference,
  scope: ExecutionScope,
  runStep: (name: N) => Promise<void>,
  parallel: (names: readonly N[]) => Promise<void>
): WorkflowContext<N, S, R> {
  return Object.freeze({
    ...reference,
    resources: data.resources,
    state: data.state,
    signal: scope.signal,
    runStep,
    parallel,
  });
}
