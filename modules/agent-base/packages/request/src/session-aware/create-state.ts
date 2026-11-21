import type { RequestWorkflowInput, RequestWorkflowState } from './types/workflow.js';

/** Select known input fields; never retain an execution context or copy caller-owned extras. */
export function createDefaultRequestState(input: RequestWorkflowInput): RequestWorkflowState {
  return {
    agentId: input.agentId,
    requestId: input.requestId,
    requestInput: input.requestInput,
    ...(input.traceEmitter === undefined ? {} : { traceEmitter: input.traceEmitter }),
  };
}
