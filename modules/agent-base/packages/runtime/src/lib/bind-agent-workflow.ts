import { traceErrorCode } from '@print-an-agent/base-observability';
import type { AnyAgentRunContext } from '../types/context.js';
import type { AgentWorkflow, AgentWorkflowBinding } from '../types/workflow.js';
import { AgentRunError } from '../types/errors.js';
import { createWorkflowTraceObserver } from './workflow-tracing.js';

/** Bind a public Core Workflow to Agent Run correlation and explicit result application. */
export function bindAgentWorkflow<C extends AnyAgentRunContext, TResult>(
  binding: AgentWorkflowBinding<C, TResult>
): AgentWorkflow<C, TResult> {
  const { workflow, applyResult } = binding;
  return Object.freeze({
    name: workflow.name,
    async run(context: C) {
      const result = await workflow.run({
        input: context,
        signal: context.signal,
        parentRunId: context.runId,
        classifyFailure: traceErrorCode,
        ...(context.traceEmitter === undefined
          ? {}
          : { onEvent: createWorkflowTraceObserver(context.traceEmitter) }),
      });
      return Object.freeze({
        result,
        async applyTo(target: C) {
          if (target !== context) {
            throw new AgentRunError(
              'WORKFLOW_RESULT_CONTEXT_MISMATCH',
              `Workflow result from "${workflow.name}" belongs to another Agent Run.`,
              workflow.name
            );
          }
          await applyResult(context, result);
        },
      });
    },
  });
}
