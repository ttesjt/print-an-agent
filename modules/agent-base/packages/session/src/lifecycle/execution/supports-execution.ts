import type { SessionExecutionPort } from './types/ports.js';

export function supportsSessionExecution(value: object): value is SessionExecutionPort {
  return (
    'acquireSessionExecution' in value &&
    typeof value.acquireSessionExecution === 'function' &&
    'releaseSessionExecution' in value &&
    typeof value.releaseSessionExecution === 'function'
  );
}
