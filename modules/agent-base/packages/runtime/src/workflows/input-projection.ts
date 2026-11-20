import { isPromise } from 'node:util/types';

import { AgentRunError } from '../errors.js';

export function requireSynchronousInput<TInput>(input: TInput, workflowName: string): TInput {
  if (isPromise(input)) {
    // Observe native rejections immediately, including across realms. Do not await an invalid
    // projection or access a Promise's possibly overridden then property.
    void Promise.prototype.then.call(
      input,
      () => undefined,
      () => undefined
    );
  } else if (
    !((typeof input === 'object' && input !== null) || typeof input === 'function') ||
    typeof Reflect.get(input, 'then') !== 'function'
  ) {
    return input;
  }
  throw new AgentRunError(
    'WORKFLOW_INPUT_PROJECTION_ASYNC',
    'Workflow input projection must return a synchronous value.',
    workflowName
  );
}
