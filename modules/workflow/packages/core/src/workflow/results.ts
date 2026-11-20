import { isPromise } from 'node:util/types';
import { WorkflowRunError } from '../contracts/index.js';

export function requireSynchronousResult<T>(
  result: T,
  factory: 'createResult' | 'createSkippedResult'
): T {
  if (isPromise(result)) {
    // Observe rejection now, including across realms and while lifecycle cleanup is pending.
    void Promise.prototype.then.call(
      result,
      () => undefined,
      () => undefined
    );
  } else if (
    !((typeof result === 'object' && result !== null) || typeof result === 'function') ||
    typeof Reflect.get(result, 'then') !== 'function'
  ) {
    return result;
  }
  throw new WorkflowRunError(
    'WORKFLOW_RESULT_ASYNC',
    `${factory} must return a synchronous result.`,
    factory
  );
}
