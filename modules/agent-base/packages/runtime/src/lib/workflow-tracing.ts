import type { AgentTraceEmitter } from '@ta-agent/base-observability';
import type { WorkflowObserver } from '@ta-agent/workflow-core';

/** Core owns execution metadata; the emitter already owns Agent identity and Run correlation. */
export function createWorkflowTraceObserver(emitter: AgentTraceEmitter): WorkflowObserver {
  return (event) => {
    const workflow = { workflowName: event.workflowName, workflowRunId: event.workflowRunId };
    switch (event.type) {
      case 'workflow-started':
        return emitter.record({ type: 'workflow-run-started', ...workflow });
      case 'workflow-completed':
        return emitter.record({ type: 'workflow-run-completed', ...workflow });
      case 'workflow-skipped':
        return emitter.record({ type: 'workflow-run-skipped', ...workflow });
      case 'workflow-failed':
        return emitter.record({
          type: 'workflow-run-failed',
          ...workflow,
          errorCode: event.errorCode ?? 'UNEXPECTED_ERROR',
        });
      case 'step-started':
      case 'step-completed':
      case 'step-skipped':
        return emitter.record({ type: event.type, ...workflow, stepName: event.stepName });
      case 'step-failed':
        return emitter.record({
          type: event.type,
          ...workflow,
          stepName: event.stepName,
          errorCode: event.errorCode ?? 'UNEXPECTED_ERROR',
        });
    }
  };
}
