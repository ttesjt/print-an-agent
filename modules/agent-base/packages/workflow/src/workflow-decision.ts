import type { WorkflowDecision } from './types/workflow.js';

export const RUN_WORKFLOW: WorkflowDecision = Object.freeze({ status: 'run' });

export function skipWorkflow(reason: string): WorkflowDecision {
  return Object.freeze({ status: 'skip', reason });
}
