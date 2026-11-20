import type { WorkflowContext, WorkflowEventReference } from '../../contracts/index.js';
import type { ExecutionScope } from '../scope/index.js';
import type { RunData } from '../types.js';

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
